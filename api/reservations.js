const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!MONGODB_URI) return res.status(500).json({ message: 'MONGODB_URI non configurée.' });

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ message: 'Paramètres start et end requis.' });

  const client = new MongoClient(MONGODB_URI);

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
