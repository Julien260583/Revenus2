const { MongoClient } = require('mongodb');

/**
 * GET /api/sync-status
 * Retourne le dernier log de synchronisation (cron ou manuel).
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user     = process.env.MONGODB_USER;
  const password = process.env.MONGODB_PASSWORD;
  const cluster  = process.env.MONGODB_CLUSTER;

  if (!user || !password || !cluster) {
    return res.status(500).json({ message: 'Variables MongoDB manquantes.' });
  }

  const uri = `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${cluster}/lodgify?appName=revenus`;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const logs = client.db('lodgify').collection('sync_logs');

    // Dernier log global (cron ou manuel)
    const last = await logs.findOne({}, { sort: { executedAt: -1 } });

    // Dernier log du cron uniquement (source: 'cron')
    const lastCron = await logs.findOne({ source: 'cron' }, { sort: { executedAt: -1 } });

    return res.status(200).json({ last: last || null, lastCron: lastCron || null });
  } catch (err) {
    return res.status(500).json({ message: 'Erreur MongoDB', details: err.message });
  } finally {
    await client.close();
  }
};
