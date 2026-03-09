module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.LODGIFY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ message: 'LODGIFY_API_KEY non configurée dans les variables Vercel.' });
  }

  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ message: 'Paramètres start et end requis.' });
  }

  // Lodgify API v2 — paramètres dateFrom / dateTo
  const url = `https://api.lodgify.com/v2/reservations/bookings?dateFrom=${start}&dateTo=${end}&includeCount=true&size=100`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-ApiKey': apiKey,
        'Accept': 'application/json'
      }
    });

    const body = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        message: `Erreur Lodgify (${response.status})`,
        details: body
      });
    }

    try {
      const data = JSON.parse(body);
      return res.status(200).json(data);
    } catch {
      return res.status(500).json({ message: 'Réponse non-JSON de Lodgify', details: body });
    }

  } catch (error) {
    return res.status(500).json({ message: 'Impossible de contacter Lodgify.', details: error.message });
  }
};
