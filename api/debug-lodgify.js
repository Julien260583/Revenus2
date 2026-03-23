/**
 * GET /api/debug-lodgify
 * Retourne les stats brutes de l'API Lodgify pour diagnostiquer les réservations manquantes.
 * À supprimer après diagnostic.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const lodgifyKey = process.env.LODGIFY_API_KEY;
  if (!lodgifyKey) return res.status(500).json({ message: 'LODGIFY_API_KEY manquante.' });

  // Protection minimale
  if (process.env.CRON_SECRET && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: 'Secret requis.' });
  }

  const fromDate = '2020-01-01';
  const toDate   = new Date(new Date().setMonth(new Date().getMonth() + 12))
                     .toISOString().split('T')[0];

  try {
    // Page 1 avec size=200
    const url = `https://api.lodgify.com/v2/reservations/bookings?dateFrom=${fromDate}&dateTo=${toDate}&includeCount=true&size=200&page=1`;
    const response = await fetch(url, {
      headers: { 'X-ApiKey': lodgifyKey, 'Accept': 'application/json' }
    });
    const data = await response.json();

    const items = data.items || [];

    // Grouper par statut
    const byStatus = {};
    items.forEach(b => {
      const s = b.status || 'null';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });

    // Réservations futures (arrivée > aujourd'hui)
    const today = new Date().toISOString().split('T')[0];
    const future = items.filter(b => b.arrival > today);
    const past   = items.filter(b => b.arrival <= today);

    return res.status(200).json({
      dateRange:    { fromDate, toDate },
      totalReported: data.count,
      totalFetched:  items.length,
      byStatus,
      futureCount:  future.length,
      pastCount:    past.length,
      // Les 10 prochaines réservations par date d'arrivée
      nextBookings: future
        .sort((a, b) => a.arrival.localeCompare(b.arrival))
        .slice(0, 10)
        .map(b => ({
          id:        b.id,
          status:    b.status,
          arrival:   b.arrival,
          departure: b.departure,
          property:  b.property_id,
          amount:    b.total_amount,
          guest:     b.guest?.name,
        })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
