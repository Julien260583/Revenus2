export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { start, end } = req.query;
  const apiKey = process.env.LODGIFY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ message: 'LODGIFY_API_KEY non configurée dans les variables Vercel.' });
  }

  if (!start || !end) {
    return res.status(400).json({ message: 'Paramètres start et end requis.' });
  }

  const url = `https://api.lodgify.com/v1/reservations/bookings?minArrival=${start}&maxArrival=${end}`;

  try {
    const response = await fetch(url, {
      headers: { 'X-ApiKey': apiKey }
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
}
