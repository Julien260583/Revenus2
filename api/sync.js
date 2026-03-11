const { MongoClient } = require('mongodb');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Sécurité : autoriser uniquement les appels venant du cron Vercel
  // ou les appels manuels authentifiés via CRON_SECRET
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';

  if (!isVercelCron && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return res.status(401).json({ message: 'Non autorisé.' });
  }

  const user        = process.env.MONGODB_USER;
  const password    = process.env.MONGODB_PASSWORD;
  const cluster     = process.env.MONGODB_CLUSTER;
  const lodgifyKey  = process.env.LODGIFY_API_KEY;

  if (!user || !password || !cluster) {
    return res.status(500).json({ message: 'Variables MongoDB manquantes.' });
  }
  if (!lodgifyKey) {
    return res.status(500).json({ message: 'LODGIFY_API_KEY non configurée.' });
  }

  const uri = `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${cluster}/lodgify?appName=revenus`;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const col = client.db('lodgify').collection('reservations');

    const fromDate = '2020-01-01';
    const toDate   = new Date(new Date().setMonth(new Date().getMonth() + 12))
                       .toISOString().split('T')[0];

    let page     = 1;
    const size   = 200;
    let total    = 0;
    let upserted = 0;

    while (true) {
      const url = `https://api.lodgify.com/v2/reservations/bookings?dateFrom=${fromDate}&dateTo=${toDate}&includeCount=true&size=${size}&page=${page}`;

      const response = await fetch(url, {
        headers: { 'X-ApiKey': lodgifyKey, 'Accept': 'application/json' }
      });

      if (!response.ok) {
        const body = await response.text();
        return res.status(response.status).json({ message: `Erreur Lodgify (${response.status})`, details: body });
      }

      const data  = await response.json();
      const items = data.items || [];
      if (total === 0) total = data.count || 0;
      if (items.length === 0) break;

      const ops = items.map(b => ({
        updateOne: {
          filter: { id: b.id },
          update: { $set: { ...b, _syncedAt: new Date() } },
          upsert: true
        }
      }));

      const result = await col.bulkWrite(ops);
      upserted += result.upsertedCount + result.modifiedCount;

      if (items.length < size) break;
      page++;
    }

    return res.status(200).json({ message: 'Sync terminée', total, upserted });

  } catch (err) {
    return res.status(500).json({ message: 'Erreur sync', details: err.message });
  } finally {
    await client.close();
  }
};
