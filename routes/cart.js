// Cross-device cart, as a pointer table: { customerId, cartId }. Shopify's Cart API
// has no customer -> cart lookup (that went away with lastIncompleteCheckout), which
// is the one reason this needs storing at all. Contents stay in Shopify.
const { bearer } = require('../lib/auth');
const shopifyCart = require('../lib/shopifyCart');

module.exports = async function cartRoutes(fastify) {
  const carts = () => fastify.mongo.db.collection('carts');

  // POST /api/cart/attach { cartId }
  //
  // Called right after login with whatever cart the browser is holding. Returns the
  // cart id to use from here on, which may be the customer's saved one — so the
  // frontend needs no separate "fetch my cart" call.
  fastify.post('/attach', { preHandler: fastify.requireCustomer }, async (request, reply) => {
    const customerId = request.customer.id;
    const guestCartId = String(request.body?.cartId || '').trim() || null;

    // DEGRADE, DON'T FAIL. This runs inside login. Cross-device cart is a convenience; being unable
    // to sign in is not, and a Mongo outage (an expired Atlas IP allowlist entry is enough) was
    // turning one into the other. If the pointer store is unreachable we still hand the cart to
    // Shopify — which is the part checkout actually needs — and carry on without the pointer.
    let saved = null;
    let pointerStoreUp = true;
    try {
      saved = await carts().findOne({ customerId });
    } catch (err) {
      pointerStoreUp = false;
      request.log.error({ err: err.message }, 'cart pointer store unreachable');
    }
    const savedCart = saved?.cartId ? await shopifyCart.getCart(saved.cartId) : null;
    const guestCart = guestCartId ? await shopifyCart.getCart(guestCartId) : null;

    // A saved id that Shopify no longer recognises is worse than none — it would
    // hand the customer an empty cart on every device. Treat it as absent.
    let cartId = savedCart?.id || guestCart?.id || null;

    if (savedCart && guestCart && savedCart.id !== guestCart.id) {
      const toCopy = shopifyCart.linesToCopy(guestCart, savedCart);
      if (toCopy.length) await shopifyCart.addLines(savedCart.id, toCopy);
      cartId = savedCart.id;
    }

    if (!cartId) {
      // Nothing to point at yet. Not an error: the customer simply has no cart.
      if (pointerStoreUp) await carts().deleteOne({ customerId }).catch(() => {});
      return { cartId: null, merged: false };
    }

    await shopifyCart.attachBuyer(cartId, bearer(request)).catch(() => false);

    if (pointerStoreUp) {
      await carts()
        .updateOne(
          { customerId },
          { $set: { customerId, cartId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        )
        .catch((err) => {
          pointerStoreUp = false;
          request.log.error({ err: err.message }, 'cart pointer write failed');
        });
    }

    return {
      cartId,
      merged: Boolean(savedCart && guestCart && savedCart.id !== guestCart.id),
      // Told, not hidden: the cart works, it just will not follow them to another device this time.
      pointerSaved: pointerStoreUp,
    };
  });

  // GET /api/cart/attach — which cart is this customer's, on a fresh device.
  fastify.get('/attach', { preHandler: fastify.requireCustomer }, async (request) => {
    const saved = await carts()
      .findOne({ customerId: request.customer.id })
      .catch((err) => {
        request.log.error({ err: err.message }, 'cart pointer store unreachable');
        return null;
      });
    if (!saved?.cartId) return { cartId: null };

    const cart = await shopifyCart.getCart(saved.cartId);
    if (!cart) {
      await carts().deleteOne({ customerId: request.customer.id });
      return { cartId: null };
    }
    return { cartId: cart.id, totalQuantity: cart.totalQuantity, checkoutUrl: cart.checkoutUrl };
  });
};
