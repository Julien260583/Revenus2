const { runSync } = require('./_syncCore');

/**
 * POST /api/sync-manual
 * Appelé depuis le bouton "Synchroniser" du dashboard.
 * Accessible sans authentification (dashboard interne).
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Méthode non autorisée.' });
  }

  try {
    const { total, upserted } = await runSync();
    return res.status(200).json({ message: 'Sync terminée', total, upserted });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
