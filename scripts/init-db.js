// Creates the collections and indexes. Idempotent — run it against a new database,
// or after adding an index here. `node scripts/init-db.js`
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');

// cod_ledger is deliberately absent: its shape depends on whether the PPCOD
// remainder is collected as cash (needs collectedBy + a reconciliation state) or via
// a payment link (needs a second Razorpay order id). Added with the payment routes.
const COLLECTIONS = {
  // Pointer table, not a cart mirror — see routes/cart.js.
  carts: [{ key: { customerId: 1 }, unique: true }],

  wishlists: [
    // Partial uniqueness because a document has one identity or the other, never
    // both; a plain unique index would collide every guest doc on customerId: null.
    { key: { customerId: 1 }, unique: true, partialFilterExpression: { customerId: { $exists: true } } },
    { key: { sessionId: 1 }, unique: true, partialFilterExpression: { sessionId: { $exists: true } } },
    // Guest wishlists that never became accounts are landfill. 180 days.
    { key: { updatedAt: 1 }, expireAfterSeconds: 180 * 24 * 60 * 60, partialFilterExpression: { sessionId: { $exists: true } } },
  ],

  // A thin mirror of Shopify orders, kept for one question: did every Razorpay
  // payment produce an order? The unique index is what makes a retried verify
  // idempotent instead of double-recording a payment.
  orders: [
    { key: { razorpayPaymentId: 1 }, unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } },
    { key: { shopifyOrderId: 1 } },
    { key: { customerId: 1, createdAt: -1 } },
  ],

  pincodes: [{ key: { pincode: 1 }, unique: true }],

  // The per-customer Shopify password, encrypted. Exists so signing in does not rotate the password
  // and thereby invalidate every other session — see lib/customerPassword.js.
  shopify_credentials: [{ key: { customerId: 1 }, unique: true }],

  // Floor / lift / property type per saved address — the inputs an unloading charge is computed
  // from. Shopify's MailingAddress has nowhere to put them. See lib/addressMeta.js.
  address_meta: [{ key: { customerId: 1, addressId: 1 }, unique: true }],
};

// Atlas requires a collection name when you create a database, so each new database
// arrives with an empty collection named after itself. Not one of ours.
const isAtlasPlaceholder = (name, dbName) => name === dbName;

(async () => {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;
  if (!uri || !dbName) {
    console.error('MONGODB_URI and MONGODB_DB must be set');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`database: ${db.databaseName}\n`);

    const existing = (await db.listCollections().toArray()).map((c) => c.name);

    for (const [name, indexes] of Object.entries(COLLECTIONS)) {
      if (!existing.includes(name)) {
        await db.createCollection(name);
        console.log(`created   ${name}`);
      } else {
        console.log(`exists    ${name}`);
      }

      for (const { key, ...options } of indexes) {
        // createIndex is idempotent for an identical spec, and throws on a
        // conflicting one — which is the signal you wanted, not something to hide.
        const indexName = await db.collection(name).createIndex(key, options);
        console.log(`  index   ${indexName}${options.unique ? ' (unique)' : ''}${options.expireAfterSeconds ? ' (ttl)' : ''}`);
      }
    }

    for (const name of existing) {
      if (isAtlasPlaceholder(name, dbName)) {
        if ((await db.collection(name).countDocuments()) === 0) {
          await db.collection(name).drop();
          console.log(`\ndropped   ${name} (empty Atlas placeholder)`);
        } else {
          console.log(`\nkept      ${name} — placeholder name but it has documents, look before dropping`);
        }
      }
    }

    console.log('\ndone');
  } catch (err) {
    console.error('failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
