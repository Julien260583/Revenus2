const { runSync } = require('./_syncCore');

/**
 * GET /api/sync
 * Réservé au cron Vercel (header x-vercel-cron: 1).
 * Ne pas appeler depuis le frontend.
 */
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Autoriser uniquement les appels du cron Vercel
  if (req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ message: 'Réservé au cron Vercel.' });
  }

  try {
    const { total, upserted } = await runSync('cron');
    return res.status(200).json({ message: 'Sync terminée', total, upserted });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
