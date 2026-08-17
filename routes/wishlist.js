// Wishlist. The one thing Shopify has no primitive for, so it genuinely needs a
// collection. Six components in material-frontend already call these endpoints.
//
// Shape matches what src/lib/api.js sends: identity in the query string, product or
// items in the body. What it does NOT do is believe the `userId` those helpers pass
// — see identityFor.
const { identityFor } = require('../lib/auth');

// The wishlist is the only customer-facing feature that genuinely needs the database, so it is the
// one that shows when the database is away. It degrades by DIRECTION:
//   reads  -> an empty list, 200. The browser still holds the guest copy and the heart keeps working.
//   writes -> 503 with a sentence a customer can act on, never a silent success. Pretending a save
//             worked is how someone loses a list they think they saved.
const DOWN = 'Saved items are unavailable for a moment. Please try again shortly.';

const isDbDown = (err) =>
  /Topology is closed|must be connected|ECONNREFUSED|ServerSelection|SSL|tlsv1/i.test(err?.message || '');

const sameItem = (a, b) =>
  String(a.productId) === String(b.productId) &&
  String(a.variantId || '') === String(b.variantId || '');

module.exports = async function wishlistRoutes(fastify) {
  const wishlists = () => fastify.mongo.db.collection('wishlists');

  // Guests are allowed here, so authenticate rather than require.
  fastify.addHook('preHandler', async (request) => {
    await fastify.authenticate(request);
  });

  const keyFor = (request) => {
    const fromQuery = request.query?.sessionId;
    const fromBody = request.body?.sessionId;
    return identityFor(request, fromQuery || fromBody);
  };

  fastify.get('/', async (request, reply) => {
    const key = keyFor(request);
    if (!key) return { items: [] };

    try {
      const doc = await wishlists().findOne(key);
      return { items: doc?.items || [] };
    } catch (err) {
      if (!isDbDown(err)) throw err;
      request.log.error({ err: err.message.slice(0, 100) }, 'wishlist read failed');
      return { items: [], degraded: true };
    }
  });

  // One POST for both "add this product" and "replace with these items", because
  // that is what the frontend's addWishlistApi and syncWishlistApi already send.
  fastify.post('/', async (request, reply) => {
    const key = keyFor(request);
    if (!key) return reply.code(400).send({ error: 'Sign in or send a sessionId' });

    const { product, items } = request.body || {};
    let doc = null;
    try {
      doc = await wishlists().findOne(key);
    } catch (err) {
      if (!isDbDown(err)) throw err;
      return reply.code(503).send({ error: DOWN });
    }
    let next = doc?.items || [];

    if (Array.isArray(items)) {
      next = items;
    } else if (product?.productId) {
      if (!next.some((i) => sameItem(i, product))) next = [product, ...next];
    } else {
      return reply.code(400).send({ error: 'Send a product or an items array' });
    }

    try {
      await wishlists().updateOne(
        key,
        { $set: { ...key, items: next, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    } catch (err) {
      if (!isDbDown(err)) throw err;
      request.log.error({ err: err.message.slice(0, 100) }, 'wishlist write failed');
      return reply.code(503).send({ error: DOWN });
    }
    return { items: next };
  });

  fastify.delete('/', async (request, reply) => {
    const key = keyFor(request);
    if (!key) return reply.code(400).send({ error: 'Sign in or send a sessionId' });

    const { productId, variantId } = request.query || {};
    if (!productId) return reply.code(400).send({ error: 'productId is required' });

    try {
      const doc = await wishlists().findOne(key);
      if (!doc) return { items: [] };

      const next = doc.items.filter((i) => !sameItem(i, { productId, variantId }));
      await wishlists().updateOne(key, { $set: { items: next, updatedAt: new Date() } });
      return { items: next };
    } catch (err) {
      if (!isDbDown(err)) throw err;
      request.log.error({ err: err.message.slice(0, 100) }, 'wishlist delete failed');
      return reply.code(503).send({ error: DOWN });
    }
  });

  // Called on login: fold the guest wishlist into the customer's own, then drop the
  // guest document. loginSuccess in the ported auth UI dispatches this.
  // Runs during login, so it degrades rather than failing: a customer who cannot reach the wishlist
  // store should still get a session. They keep whatever the browser holds and the merge retries on
  // the next sign-in.
  fastify.post('/merge', { preHandler: fastify.requireCustomer }, async (request, reply) => {
    const sessionId = String(request.body?.sessionId || '').trim();
    const customerKey = { customerId: request.customer.id };

    try {
      if (!sessionId) {
        const mine = await wishlists().findOne(customerKey);
        return { items: mine?.items || [] };
      }

      const [guest, mine] = await Promise.all([
        wishlists().findOne({ sessionId }),
        wishlists().findOne(customerKey),
      ]);

      const merged = [...(mine?.items || [])];
      for (const item of guest?.items || []) {
        if (!merged.some((i) => sameItem(i, item))) merged.push(item);
      }

      await wishlists().updateOne(
        customerKey,
        { $set: { ...customerKey, items: merged, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      if (guest) await wishlists().deleteOne({ sessionId });

      return { items: merged };
    } catch (err) {
      request.log.error({ err: err.message }, 'wishlist merge failed');
      // 200 with merged:false, not a 500. The caller is finishLogin — an error here would be logged
      // as a failed request during an otherwise successful sign-in, and the customer keeps whatever
      // the browser is holding either way.
      return { items: [], merged: false };
    }
  });
};
