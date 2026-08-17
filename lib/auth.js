// Resolves the Shopify customer access token the frontend sends as a Bearer header
// (apiFetch pulls it out of redux-persist) into an actual customer.
//
// This exists because "trust the userId in the query string" is not authentication.
// Lucira's wishlist and cart routes take `userId` straight off the request, so
// anyone who knows or guesses a customer id can read and write that customer's
// data — and its /api/admin/carts hands out 100 customer ids to start you off.
const { storefrontGraphql } = require('./shopify');

const bearer = (request) => {
  const header = request.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : request.cookies?.customerAccessToken || null;
};

// ponytail: one Storefront round-trip per authenticated request, uncached. Shopify
// is the only thing that can say whether a token is still valid, and a cache means
// a revoked token keeps working for its TTL. Add a short-lived cache only if this
// shows up in latency, and keep it well under the token's lifetime.
async function resolveCustomer(token) {
  if (!token) return null;
  const data = await storefrontGraphql(
    `query me($token: String!) {
       customer(customerAccessToken: $token) { id email firstName lastName phone }
     }`,
    { token },
  );
  return data?.customer || null;
}

// fastify.authenticate — populates request.customer, or null for a guest.
// fastify.requireCustomer — 401s a guest. Use as a preHandler.
async function authPlugin(fastify) {
  fastify.decorateRequest('customer', null);

  fastify.decorate('authenticate', async (request) => {
    request.customer = await resolveCustomer(bearer(request)).catch(() => null);
    return request.customer;
  });

  fastify.decorate('requireCustomer', async (request, reply) => {
    await fastify.authenticate(request);
    if (!request.customer) {
      // 401 specifically: apiFetch treats it as a dead session and logs the user out.
      return reply.code(401).send({ error: 'Please sign in again' });
    }
  });
}

// The identity a cart or wishlist is filed under. A signed-in customer is always
// keyed by their customer id; a guest by the random sessionId the frontend
// generates. A caller may NOT name a userId they haven't proved they own.
function identityFor(request, sessionIdFromRequest) {
  if (request.customer) return { customerId: request.customer.id };
  const sessionId = String(sessionIdFromRequest || '').trim();
  return sessionId ? { sessionId } : null;
}

module.exports = require('fastify-plugin')(authPlugin);
module.exports.resolveCustomer = resolveCustomer;
module.exports.identityFor = identityFor;
module.exports.bearer = bearer;
