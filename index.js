require('dotenv').config();

const fastify = require('fastify')({
  // Under routerOptions, not top-level: Fastify 5 deprecated the flat form and
  // removes it in 6. lucira-backend/index.js still has the old spelling.
  routerOptions: { ignoreTrailingSlash: true },
  logger: { transport: { target: 'pino-pretty' } },
});

fastify.register(require('@fastify/cors'), {
  origin: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  credentials: true,
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
});

// A DELETE that carries `Content-Type: application/json` but no body is normal — axios and several
// HTTP clients send it that way — and Fastify's default parser rejects it with a 400 before any
// route runs. Treat an empty body as {} rather than an error.
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  if (!body || !body.trim()) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err);
  }
});

fastify.register(require('@fastify/cookie'));

fastify.register(require('./lib/mongo'));

fastify.register(require('./lib/auth'));

// Coarse per-IP cap so a single host can't grind the Shopify Admin API or MSG91.
// Per-phone limits live in lib/smsThrottle.js — an IP cap alone does nothing about
// one attacker rotating IPs against one number.
fastify.register(require('@fastify/rate-limit'), {
  global: true,
  max: Number(process.env.RATE_LIMIT_MAX || 60),
  timeWindow: '1 minute',
});

// Reports the DEPENDENCIES, not just that the process is alive. An unreachable Atlas (an IP that
// dropped off the allowlist is enough) otherwise shows up as a 500 on whichever route touches Mongo
// first, which sends you looking at that route instead of at the database.
fastify.get('/health', async () => {
  // Raced against a short timer: the driver waits out its full server-selection window (30s by
  // default) before admitting it cannot connect, and a health check that hangs for 30s is useless to
  // whatever is polling it.
  const mongo = await Promise.race([
    fastify.mongo.db
      .command({ ping: 1 })
      .then(() => 'ok')
      .catch((err) => `unreachable: ${err.message.split('\n')[0].slice(0, 90)}`),
    new Promise((resolve) => setTimeout(() => resolve('unreachable: timed out after 3s'), 3000)),
  ]);

  return { status: mongo === 'ok' ? 'ok' : 'degraded', mongo, timestamp: new Date().toISOString() };
});

fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
fastify.register(require('./routes/wishlist'), { prefix: '/api/wishlist' });
fastify.register(require('./routes/cart'), { prefix: '/api/cart' });
fastify.register(require('./routes/customer'), { prefix: '/api/customer' });
fastify.register(require('./routes/payment'), { prefix: '/api/payment' });

// Fail at boot, not on the first customer's login attempt.
const REQUIRED_ENV = [
  'SHOPIFY_STORE_DOMAIN',
  // Admin API tokens are minted per-day from these via client_credentials — see
  // lib/adminToken.js. There is no long-lived SHOPIFY_ADMIN_TOKEN to configure.
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_STOREFRONT_TOKEN',
  'MSG91_AUTH_KEY',
  'MSG91_TEMPLATE_ID',
  'OTP_PROOF_SECRET',
  'MONGODB_URI',
  'MONGODB_DB',
];

const start = async () => {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}\nSee .env.example`);
    process.exit(1);
  }

  try {
    const port = Number(process.env.PORT || 8080);
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    console.log(`Material backend on http://${host}:${port}`);

    // Loud on purpose. A fixed-OTP backdoor that nobody remembers enabling is the dangerous kind,
    // and this is the one line that will be in front of someone's eyes on every deploy.
    const { testOtpEnabled, TEST_MOBILES } = require('./lib/msg91');
    if (testOtpEnabled()) {
      console.warn(
        `\n  !!  TEST OTP IS ACTIVE for ${[...TEST_MOBILES].join(', ')} — a fixed code signs these\n` +
          `      numbers in without an SMS. Clear TEST_OTP_MOBILES before this is public.\n`,
      );
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
