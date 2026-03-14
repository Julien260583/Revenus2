const { MongoClient } = require('mongodb');

/**
 * Logique de synchronisation Lodgify → MongoDB.
 * Appelée depuis /api/sync (cron) et /api/sync-manual (bouton UI).
 *
 * WORKAROUND BUG LODGIFY : l'API /v2/reservations/bookings omet parfois
 * les réservations les plus récentes dans la liste paginée (index non mis
 * à jour en temps réel). On effectue donc un second passage en récupérant
 * chaque réservation individuellement via son ID pour les bookings créés
 * ou modifiés dans les 14 derniers jours.
 */
async function fetchAllPages(lodgifyKey, fromDate, toDate, size) {
  const items = [];
  let page = 1;
  let total = 0;

  while (true) {
    const url = `https://api.lodgify.com/v2/reservations/bookings?dateFrom=${fromDate}&dateTo=${toDate}&includeCount=true&size=${size}&page=${page}`;
    const response = await fetch(url, {
      headers: { 'X-ApiKey': lodgifyKey, 'Accept': 'application/json' }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erreur Lodgify liste (${response.status}) : ${body}`);
    }
    const data = await response.json();
    if (total === 0) total = data.count || 0;
    const batch = data.items || [];
    items.push(...batch);
    if (batch.length < size) break;
    page++;
  }

  return { items, total };
}

async function fetchRecentByIds(lodgifyKey, knownIds) {
  // Cherche les réservations récentes via l'endpoint sans filtre de date,
  // triées par création décroissante — récupère les 50 plus récentes
  // et retourne celles qui ne sont pas déjà dans knownIds.
  const url = `https://api.lodgify.com/v2/reservations/bookings?includeCount=true&size=50&page=1`;
  const response = await fetch(url, {
    headers: { 'X-ApiKey': lodgifyKey, 'Accept': 'application/json' }
  });
  if (!response.ok) return [];

  const data = await response.json();
  const all = data.items || [];

  // Garde uniquement celles absentes du premier passage
  const missing = all.filter(b => !knownIds.has(b.id));
  return missing;
}

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
    const size = 200;

    // --- Passage 1 : liste paginée standard ---
    const { items: mainItems, total } = await fetchAllPages(lodgifyKey, fromDate, toDate, size);
    const knownIds = new Set(mainItems.map(b => b.id));

    // --- Passage 2 : workaround bug Lodgify ---
    // Récupère les 50 réservations les plus récentes (sans filtre date)
    // pour capturer celles omises dans la pagination principale.
    const recentMissing = await fetchRecentByIds(lodgifyKey, knownIds);

    const allItems = [...mainItems, ...recentMissing];

    let upserted = 0;
    if (allItems.length > 0) {
      const ops = allItems.map(b => ({
        updateOne: {
          filter: { id: b.id },
          update: { $set: { ...b, _syncedAt: new Date() } },
          upsert: true
        }
      }));
      const result = await col.bulkWrite(ops);
      upserted = result.upsertedCount + result.modifiedCount;
    }

    return {
      total,
      upserted,
      mainCount: mainItems.length,
      recoveredByWorkaround: recentMissing.length,
      recoveredIds: recentMissing.map(b => b.id)
    };

  } finally {
    await client.close();
  }
}

module.exports = { runSync };
