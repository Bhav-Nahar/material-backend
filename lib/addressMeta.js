/**
 * The delivery attributes Shopify has nowhere to put: property type, floor, and whether there is a
 * lift.
 *
 * WHY THEY MATTER HERE AND NOT IN A NORMAL STORE. A 900 kg tile order carried up four floors without
 * a lift is a different job from one wheeled into a ground-floor entrance, and it costs different
 * money. Material Depot prices exactly this — an "Unloading Charges" line derived from order weight,
 * floor and lift — and quotes it before payment. These three fields are the inputs.
 *
 * Shopify's MailingAddress has no field for any of it (company, address2 and the rest are postal
 * concepts), so the postal address stays in Shopify and the logistics attributes live here, joined
 * on the Shopify address id. Splitting it that way means Shopify's own checkout and shipping labels
 * keep working untouched.
 *
 * DEGRADES: every function answers with nothing rather than throwing. An address without its floor
 * is still a deliverable address — it just falls back to a quoted-by-hand freight conversation,
 * which is where the whole store is today anyway.
 */
const COLLECTION = 'address_meta';

/**
 * The join key, and it is NOT the id Shopify hands you.
 *
 * A customer address id comes back as
 *   gid://shopify/MailingAddress/11003778564233?model_name=CustomerAddress&customer_access_token=…
 *
 * — the CUSTOMER'S ACCESS TOKEN is embedded in it. That token changes every session, so the same
 * physical address arrives with a different "id" on every login: rows never matched on read, and
 * each save created another orphan. Two rows for one address inside a single test.
 *
 * The numeric id is the only stable part, so that is what we key on.
 */
const addressKey = (gid) => {
  const match = String(gid || '').match(/MailingAddress\/(\d+)/);
  return match ? match[1] : null;
};

const PROPERTY_TYPES = ['apartment', 'independent_house', 'villa', 'office', 'site', 'other'];

// Trusted only after this. `floor` arrives from a form and ends up multiplying a labour charge.
function normalise(meta = {}) {
  const floorRaw = Number(meta.floor);
  return {
    propertyType: PROPERTY_TYPES.includes(meta.propertyType) ? meta.propertyType : null,
    // 0 is ground and a real answer, so the guard is on NaN and range, not falsiness. Capped at 100
    // because nothing in the MMR is taller and an unbounded number multiplies into a silly quote.
    floor: Number.isInteger(floorRaw) && floorRaw >= 0 && floorRaw <= 100 ? floorRaw : null,
    // Tri-state on purpose: true, false, and "never asked" are three different things, and only the
    // first two can be priced. Unknown has to stay unknown rather than defaulting to the cheap one.
    liftAvailable: typeof meta.liftAvailable === 'boolean' ? meta.liftAvailable : null,
  };
}

const isEmpty = (m) => m.propertyType === null && m.floor === null && m.liftAvailable === null;

async function loadMany(db, customerId) {
  if (!db) return new Map();
  try {
    const docs = await db.collection(COLLECTION).find({ customerId }).toArray();
    return new Map(docs.map((d) => [d.addressId, normalise(d)]));  // keyed by numeric id
  } catch {
    return new Map();
  }
}

async function save(db, customerId, addressGid, meta) {
  const addressId = addressKey(addressGid);
  if (!db || !addressId) return false;
  const clean = normalise(meta);

  try {
    if (isEmpty(clean)) {
      // Nothing worth storing — and clearing it is how a customer says "actually, I don't know".
      await db.collection(COLLECTION).deleteOne({ customerId, addressId });
      return true;
    }
    await db.collection(COLLECTION).updateOne(
      { customerId, addressId },
      { $set: { customerId, addressId, ...clean, updatedAt: new Date() } },
      { upsert: true },
    );
    return true;
  } catch {
    return false;
  }
}

async function remove(db, customerId, addressGid) {
  const addressId = addressKey(addressGid);
  if (!db || !addressId) return false;
  try {
    await db.collection(COLLECTION).deleteOne({ customerId, addressId });
    return true;
  } catch {
    return false;
  }
}

module.exports = { loadMany, save, remove, normalise, addressKey, PROPERTY_TYPES, COLLECTION };
