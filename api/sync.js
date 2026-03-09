const { MongoClient } = require('mongodb');

const MONGODB_URI     = process.env.MONGODB_URI;
const LODGIFY_API_KEY = process.env.LODGIFY_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!MONGODB_URI)     return res.status(500).json({ message: 'MONGODB_URI non configurée.' });
  if (!LODGIFY_API_KEY) return res.status(500).json({ message: 'LODGIFY_API_KEY non configurée.' });

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const col = client.db('lodgify').collection('reservations');

    const fromDate = '2020-01-01';
    const toDate   = new Date(new Date().setMonth(new Date().getMonth() + 12))
                       .toISOString().split('T')[0];

    let page = 1;
    const size = 200;
    let total    = 0;
    let upserted = 0;

    while (true) {
      const url = `https://api.lodgify.com/v2/reservations/bookings?dateFrom=${fromDate}&dateTo=${toDate}&includeCount=true&size=${size}&page=${page}`;

      const response = await fetch(url, {
        headers: { 'X-ApiKey': LODGIFY_API_KEY, 'Accept': 'application/json' }
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
