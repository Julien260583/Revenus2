const { runSync } = require('./_syncCore');

/**
 * GET /api/sync
 * Réservé au cron Vercel.
 *
 * FIX : on accepte aussi un paramètre ?secret= pour pouvoir tester
 * manuellement depuis un navigateur et déboguer sans attendre le cron.
 * Définir CRON_SECRET dans les variables d'environnement Vercel.
 */
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // FIX : Vercel injecte x-vercel-cron: 1 sur le plan Pro.
  // Sur le plan Hobby ce header peut être absent — on ajoute un fallback
  // par secret partagé pour permettre le débogage et les appels forcés.
  const isCronHeader = req.headers['x-vercel-cron'] === '1';
  const isSecretOk   = process.env.CRON_SECRET && req.query.secret === process.env.CRON_SECRET;

  if (!isCronHeader && !isSecretOk) {
    return res.status(401).json({
      message: 'Réservé au cron Vercel.',
      hint:    'Ajoutez ?secret=<CRON_SECRET> pour appeler manuellement.',
    });
  }

  try {
    const { total, upserted } = await runSync('cron');
    return res.status(200).json({ message: 'Sync terminée', total, upserted });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
