const { MongoClient } = require('mongodb');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user     = process.env.MONGODB_USER;
  const password = process.env.MONGODB_PASSWORD;
  const cluster  = process.env.MONGODB_CLUSTER;

  if (!user || !password || !cluster) {
    return res.status(500).json({ message: 'Variables MongoDB manquantes (MONGODB_USER, MONGODB_PASSWORD, MONGODB_CLUSTER).' });
  }

  const uri = `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${cluster}/lodgify?appName=revenus`;

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ message: 'Paramètres start et end requis.' });

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const col = client.db('lodgify').collection('reservations');

    const items = await col.find({
      arrival:   { $lte: end },
      departure: { $gte: start }
    }).toArray();

    return res.status(200).json({ count: items.length, items });

  } catch (err) {
    return res.status(500).json({ message: 'Erreur MongoDB', details: err.message });
  } finally {
    await client.close();
  }
};
