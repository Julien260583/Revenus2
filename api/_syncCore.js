const { MongoClient } = require('mongodb');

/**
 * Logique de synchronisation Lodgify → MongoDB.
 * Appelée depuis /api/sync (cron) et /api/sync-manual (bouton UI).
 *
 * BUG LODGIFY CONFIRMÉ : l'API /v2/reservations/bookings omet certaines
 * réservations de sa liste paginée (invisible même avec updatedSince,
 * même sans filtre de date). Seul l'appel direct par ID fonctionne.
 *
 * STRATÉGIE : Gap detection
 * 1. Récupérer toute la liste paginée → collecter les IDs
 * 2. Identifier la plage d'IDs à scanner (autour du max connu)
 * 3. Fetcher directement par ID tous les IDs absents de la liste
 * 4. Upsert tout en MongoDB
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

/**
 * Fetch direct d'une réservation par ID.
 * Retourne l'objet ou null si 404/erreur.
 */
async function fetchById(lodgifyKey, id) {
  try {
    const response = await fetch(
      `https://api.lodgify.com/v2/reservations/bookings/${id}`,
      { headers: { 'X-ApiKey': lodgifyKey, 'Accept': 'application/json' } }
    );
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Gap detection : scanne les IDs entre minId et maxId
 * qui ne sont pas dans knownIds, en les fetchant un par un.
 * Limité à 300 IDs max pour tenir dans le timeout Vercel (10s).
 */
async function detectGaps(lodgifyKey, knownIds, minId, maxId) {
  const found = [];
  const limit = 300;
  let checked = 0;

  for (let id = minId; id <= maxId && checked < limit; id++) {
    if (!knownIds.has(id)) {
      const booking = await fetchById(lodgifyKey, id);
      if (booking && booking.id) {
        found.push(booking);
      }
      checked++;
    }
  }

  return found;
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

    // --- Passage 1 : liste paginée standard ---
    const { items: mainItems, total } = await fetchAllPages(lodgifyKey, fromDate, toDate, 200);
    const knownIds = new Set(mainItems.map(b => b.id));
    const maxIdInList = mainItems.length > 0 ? Math.max(...mainItems.map(b => b.id)) : 0;

    // --- Passage 2 : Gap detection ---
    // Récupère le plus grand ID déjà en base pour borner la recherche
    const lastInDb = await col.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    const maxIdInDb = lastInDb ? lastInDb.id : 0;

    // Scanne les IDs entre (max - 25000) et (max + 2000)
    // La plage est volontairement resserrée pour tenir dans le timeout Vercel
    const searchMin = Math.max(maxIdInList, maxIdInDb) - 25000;
    const searchMax = Math.max(maxIdInList, maxIdInDb) + 2000;

    const gapItems = await detectGaps(lodgifyKey, knownIds, searchMin, searchMax);

    const allItems = [...mainItems, ...gapItems];

    // --- Upsert tout en MongoDB ---
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
      mainCount:   mainItems.length,
      gapFound:    gapItems.length,
      gapIds:      gapItems.map(b => b.id),
      searchRange: `${searchMin} → ${searchMax}`,
    };

  } finally {
    await client.close();
  }
}

module.exports = { runSync };
