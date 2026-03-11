const { MongoClient } = require('mongodb');

/**
 * Logique de synchronisation Lodgify → MongoDB.
 * Appelée depuis /api/sync (cron) et /api/sync-manual (bouton UI).
 */
async function runSync() {
  const user       = process.env.MONGODB_USER;
  const password   = process.env.MONGODB_PASSWORD;
  const cluster    = process.env.MONGODB_CLUSTER;
  const lodgifyKey = process.env.LODGIFY_API_KEY;

  if (!user || !password || !cluster) {
    throw new Error('Variables MongoDB manquantes (MONGODB_USER, MONGODB_PASSWORD, MONGODB_CLUSTER).');
  }
  if (!lodgifyKey) {
    throw new Error('LODGIFY_API_KEY non configurée.');
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
        throw new Error(`Erreur Lodgify (${response.status}) : ${body}`);
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

    return { total, upserted };

  } finally {
    await client.close();
  }
}

module.exports = { runSync };
