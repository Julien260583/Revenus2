const { MongoClient } = require('mongodb');

/**
 * Logique de synchronisation Lodgify → MongoDB.
 * Appelée depuis /api/sync (cron) et /api/sync-manual (bouton UI).
 *
 * OPTIMISATIONS :
 * - Diff avant écriture : on ne fait un $set que si les champs clés ont changé
 * - Gap detection limitée : seulement sur les IDs > maxIdInDb (nouveaux IDs)
 *   et parallélisée par lots de 10 pour éviter les timeouts
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
 * Gap detection parallélisée par lots.
 * Ne scanne QUE les IDs inconnus dans la plage donnée.
 * @param {number} concurrency - nb de requêtes simultanées (défaut 10)
 */
async function detectGaps(lodgifyKey, knownIds, minId, maxId, concurrency = 10) {
  const idsToCheck = [];
  for (let id = minId; id <= maxId; id++) {
    if (!knownIds.has(id)) idsToCheck.push(id);
  }

  const found = [];
  for (let i = 0; i < idsToCheck.length; i += concurrency) {
    const batch = idsToCheck.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(id => fetchById(lodgifyKey, id)));
    for (const booking of results) {
      if (booking && booking.id) found.push(booking);
    }
  }

  return found;
}

/**
 * Retourne une empreinte des champs significatifs d'une réservation Lodgify.
 * Utilisée pour détecter si une réservation a changé avant de l'écrire en base.
 */
function bookingFingerprint(b) {
  return JSON.stringify({
    status:       b.status,
    arrival:      b.arrival,
    departure:    b.departure,
    total_amount: b.total_amount,
    source:       b.source,
    property_id:  b.property_id,
    guest_name:   b.guest?.name,
  });
}

async function runSync(source = 'manual') {
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
    const knownIds    = new Set(mainItems.map(b => b.id));
    const maxIdInList = mainItems.length > 0 ? Math.max(...mainItems.map(b => b.id)) : 0;

    // --- Passage 2 : Gap detection uniquement sur les nouveaux IDs ---
    // On ne scanne que maxIdInDb+1 → maxIdInList+500
    // (les vieux gaps sont déjà en base, pas besoin de les re-chercher)
    const lastInDb  = await col.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    const maxIdInDb = lastInDb ? lastInDb.id : 0;

    const gapMin   = maxIdInDb + 1;
    const gapMax   = Math.max(maxIdInList, maxIdInDb) + 500;
    const gapItems = (gapMin <= gapMax)
      ? await detectGaps(lodgifyKey, knownIds, gapMin, gapMax)
      : [];

    const allItems = [...mainItems, ...gapItems];

    // --- Diff : récupérer les empreintes existantes en base ---
    const existingIds  = allItems.map(b => b.id);
    const existingDocs = await col
      .find({ id: { $in: existingIds } }, {
        projection: {
          id: 1, status: 1, arrival: 1, departure: 1,
          total_amount: 1, source: 1, property_id: 1, 'guest.name': 1
        }
      })
      .toArray();

    const existingMap = new Map(existingDocs.map(d => [d.id, d]));

    // --- Construire uniquement les ops nécessaires ---
    const ops = [];
    for (const b of allItems) {
      const existing = existingMap.get(b.id);

      if (!existing) {
        // Nouvelle réservation → insert
        ops.push({
          updateOne: {
            filter: { id: b.id },
            update: { $set: { ...b, _syncedAt: new Date() } },
            upsert: true,
          }
        });
      } else {
        // Réservation existante → comparer l'empreinte
        if (bookingFingerprint(b) !== bookingFingerprint(existing)) {
          ops.push({
            updateOne: {
              filter: { id: b.id },
              update: { $set: { ...b, _syncedAt: new Date() } },
              upsert: false,
            }
          });
        }
        // Sinon : aucun changement → on ignore
      }
    }

    let upserted = 0;
    if (ops.length > 0) {
      const writeResult = await col.bulkWrite(ops);
      upserted = writeResult.upsertedCount + writeResult.modifiedCount;
    }

    const result = {
      total,
      fetched:   allItems.length,
      changed:   ops.length,
      upserted,
      mainCount: mainItems.length,
      gapFound:  gapItems.length,
      gapIds:    gapItems.map(b => b.id),
      gapRange:  gapItems.length > 0 ? `${gapMin} → ${gapMax}` : 'aucun scan',
    };

    // Écriture du log de synchronisation
    try {
      const logs = client.db('lodgify').collection('sync_logs');
      await logs.insertOne({
        executedAt: new Date(),
        source,
        ...result,
        success: true,
      });
    } catch (_) {
      // Ne pas bloquer si l'écriture du log échoue
    }

    return result;

  } finally {
    await client.close();
  }
}

module.exports = { runSync };
