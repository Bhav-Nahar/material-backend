const { formatMobile, sendOtp, verifyOtp, isTestMobile } = require('../lib/msg91');
const otpProof = require('../lib/otpProof');
const smsThrottle = require('../lib/smsThrottle');
const customers = require('../lib/customer');
const prizes = require('../lib/prizes');

const THIRTY_DAYS = 30 * 24 * 60 * 60;

// The Shopify customer access token goes back in the JSON body because that is
// where the ported frontend looks for it: apiFetch reads accessToken out of
// redux-persist and sends it as a Bearer header. Lucira's verify-otp only ever set
// the cookie, so `loginSuccess` dispatched `accessToken: undefined` — which is what
// the `accessToken.startsWith('simulated_')` guard in the checkout gate is papering
// over. The httpOnly cookie is set too, so a future cookie-only frontend needs no
// backend change.
//
// ponytail: a token in localStorage is readable by any XSS on the storefront. The
// cookie-only upgrade means reworking apiFetch and every `state.user.accessToken`
// read in the frontend; not worth it before there is a frontend to rework.
// 'lax' is correct only when the frontend and this backend share a registrable
// domain (materialdepot.in + api.materialdepot.in). A frontend on *.vercel.app with
// the backend on your own domain is CROSS-site, and the browser drops a lax cookie
// without a word — it looks like "login works locally but not in production".
// Cross-site needs 'none', which the spec only honours alongside secure: true.
const SAME_SITE = process.env.COOKIE_SAMESITE || 'lax';
const COOKIE_SECURE = process.env.NODE_ENV === 'production' || SAME_SITE === 'none';

function sendSession(reply, { customer, mobile91, token, status, prize = null }) {
  reply.setCookie('customerAccessToken', token.accessToken, {
    httpOnly: true,
    path: '/',
    maxAge: THIRTY_DAYS,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
  });
  return reply.send({
    status,
    user: customers.publicShape(customer, mobile91),
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    ...(prize ? { prize } : {}),
  });
}

module.exports = async function authRoutes(fastify) {
  fastify.post('/send-otp', async (request, reply) => {
    const mobile91 = formatMobile(request.body?.mobile);
    if (!mobile91) return reply.code(400).send({ error: 'Enter a valid 10-digit mobile number' });

    // Test numbers skip the throttle: they cost nothing to "send", and a 60s cooldown between QA
    // runs is exactly the friction the fixed code exists to remove.
    const blocked = isTestMobile(mobile91) ? null : smsThrottle.check(mobile91);
    if (blocked) {
      return reply.code(429).header('Retry-After', blocked.retryAfter).send({
        error:
          blocked.reason === 'cooldown'
            ? `Please wait ${blocked.retryAfter}s before requesting another OTP`
            : 'Too many OTP requests for this number today',
        retryAfter: blocked.retryAfter,
      });
    }

    const { ok, body } = await sendOtp(mobile91);
    if (!ok) {
      request.log.error({ msg91: body }, 'MSG91 send failed');
      return reply.code(502).send({ error: 'Could not send the OTP. Please try again.' });
    }

    // Only a send that MSG91 accepted counts against the limit.
    if (!isTestMobile(mobile91)) smsThrottle.record(mobile91);
    return reply.send({ status: 'OTP_SENT' });
  });

  // Verifies the OTP and, in the same call, says whether this number already has an
  // account. Lucira shipped a separate /check-customer for that decision, which let
  // anyone probe whether a phone number was registered without proving anything.
  // Folding it in here means the answer is only ever given to someone holding a
  // valid OTP — and it removes a whole route.
  fastify.post('/verify-otp', async (request, reply) => {
    const mobile91 = formatMobile(request.body?.mobile);
    const otp = String(request.body?.otp || '').replace(/\D/g, '');
    if (!mobile91 || !otp) return reply.code(400).send({ error: 'Mobile and OTP are required' });

    const { ok, body } = await verifyOtp(mobile91, otp);
    if (!ok) return reply.code(400).send({ error: body?.message || 'Invalid or expired OTP' });

    const customer = await customers.findByPhone(mobile91);
    if (!customer) {
      return reply.send({ status: 'REGISTER_REQUIRED', otpProof: otpProof.issue(mobile91) });
    }

    // Same reasoning as register: a Shopify failure here must not reach the browser as a raw status.
    try {
      const token = await customers.issueAccessToken(customer, fastify.mongo.db);
      return sendSession(reply, { customer, mobile91, token, status: 'LOGIN' });
    } catch (err) {
      request.log.error({ err: err.message, body: err.body }, 'login failed');
      return reply.code(502).send({ error: 'Could not sign you in. Please try again.' });
    }
  });

  fastify.post('/register', async (request, reply) => {
    const { firstName, lastName, email, acceptsMarketing, signupPath, signupSource, utms } =
      request.body || {};

    // The number comes from the signed proof, never from the body — otherwise
    // register is an open endpoint for creating verified accounts on numbers the
    // caller does not control.
    const mobile91 = otpProof.verify(request.body?.otpProof);
    if (!mobile91) {
      return reply.code(401).send({ error: 'Please verify your mobile number again' });
    }

    if (!firstName || !email) return reply.code(400).send({ error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'Enter a valid email address' });
    }

    // Racing two registrations, or reusing a proof after the account exists, would
    // otherwise surface as a raw Shopify 422.
    const existing = await customers.findByPhone(mobile91);
    if (existing) {
      const token = await customers.issueAccessToken(existing, fastify.mongo.db);
      return sendSession(reply, { customer: existing, mobile91, token, status: 'LOGIN' });
    }
    if (await customers.findByEmail(email)) {
      return reply.code(409).send({ error: 'That email is already registered' });
    }

    // Decided here, on the server, and returned so the wheel can animate to it. The
    // client never picks — see lib/prizes.js.
    const prize = prizes.pick();

    // Shopify's own validation errors arrive as a 422 with a body like
    // {"password":["is too long"]}. Letting that reach the browser gives the customer a raw status
    // code and an empty object, which is exactly what happened the first time this ran for real.
    let customer;
    let token;
    try {
      customer = await customers.create({
        firstName,
        lastName,
        email,
        mobile91,
        acceptsMarketing: Boolean(acceptsMarketing),
        prize,
        signupPath,
        signupSource,
        // Sanitised inside lib/attribution -- this came off a query string and ends up on a tag.
        utms,
        db: fastify.mongo.db,
      });
      if (!customer) throw new Error('Shopify returned no customer');
      token = await customers.issueAccessToken(customer, fastify.mongo.db);
    } catch (err) {
      request.log.error({ err: err.message, body: err.body }, 'register failed');
      // Shopify's field messages are written for merchants, not shoppers, so only the one a customer
      // can act on is passed through.
      const taken = JSON.stringify(err.body?.errors || {}).includes('has already been taken');
      return reply.code(502).send({
        error: taken
          ? 'An account with those details already exists. Try logging in instead.'
          : 'Could not create your account. Please try again.',
      });
    }
    return sendSession(reply, {
      customer,
      mobile91,
      token,
      status: 'REGISTER_SUCCESS',
      prize: prize ? { id: prize.id, label: prize.label, code: prize.code } : null,
    });
  });

  // The wheel's face. Segment order and labels only, never the odds.
  fastify.get('/spin-segments', async () => ({ segments: prizes.segments() }));

  // The storefront token is not revocable from the Admin API, so logout is just
  // dropping the cookie; the frontend clears its own persisted copy.
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('customerAccessToken', { path: '/' });
    return reply.send({ status: 'LOGGED_OUT' });
  });
};
