// Email OTP via Resend. The SMS (MSG91) version of this file is routes/auth-sms.js, parked until the
// DLT registration is our own; lib/msg91.js now only supplies formatMobile for the signup number.
const { formatMobile } = require('../lib/msg91');
const { normalizeEmail, sendOtp, verifyOtp, isTestEmail } = require('../lib/emailOtp');
const otpProof = require('../lib/otpProof');
// Keyed by email address here. It is a per-key cooldown + daily cap, so the SMS limits carry over
// as the email limits unchanged: one send a minute, five a day per inbox.
const otpThrottle = require('../lib/smsThrottle');
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

function sendSession(reply, { customer, token, status, prize = null }) {
  reply.setCookie('customerAccessToken', token.accessToken, {
    httpOnly: true,
    path: '/',
    maxAge: THIRTY_DAYS,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
  });
  return reply.send({
    status,
    user: customers.publicShape(customer),
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    ...(prize ? { prize } : {}),
  });
}

module.exports = async function authRoutes(fastify) {
  fastify.post('/send-otp', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    if (!email) return reply.code(400).send({ error: 'Enter a valid email address' });

    // Test addresses skip the throttle: they cost nothing to "send", and a 60s cooldown between QA
    // runs is exactly the friction the fixed code exists to remove.
    const blocked = isTestEmail(email) ? null : otpThrottle.check(email);
    if (blocked) {
      return reply.code(429).header('Retry-After', blocked.retryAfter).send({
        error:
          blocked.reason === 'cooldown'
            ? `Please wait ${blocked.retryAfter}s before requesting another OTP`
            : 'Too many code requests for this email today',
        retryAfter: blocked.retryAfter,
      });
    }

    let result;
    try {
      result = await sendOtp(email, fastify.mongo.db, request.log);
    } catch (err) {
      result = { ok: false, body: { error: err.message } };
    }
    if (!result.ok) {
      request.log.error({ resend: result.body }, 'email OTP send failed');
      return reply.code(502).send({ error: 'Could not send the code. Please try again.' });
    }

    // Only a send that went out counts against the limit.
    if (!isTestEmail(email)) otpThrottle.record(email);
    return reply.send({ status: 'OTP_SENT' });
  });

  // Verifies the OTP and, in the same call, says whether this email already has an
  // account. Lucira shipped a separate /check-customer for that decision, which let
  // anyone probe whether an account was registered without proving anything.
  // Folding it in here means the answer is only ever given to someone holding a
  // valid OTP — and it removes a whole route.
  fastify.post('/verify-otp', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const otp = String(request.body?.otp || '').replace(/\D/g, '');
    if (!email || !otp) return reply.code(400).send({ error: 'Email and code are required' });

    const { ok, body } = await verifyOtp(email, otp, fastify.mongo.db);
    if (!ok) return reply.code(400).send({ error: body?.message || 'Invalid or expired code' });

    const customer = await customers.findByEmail(email);
    if (!customer) {
      return reply.send({ status: 'REGISTER_REQUIRED', otpProof: otpProof.issue(email) });
    }

    // Same reasoning as register: a Shopify failure here must not reach the browser as a raw status.
    try {
      const token = await customers.issueAccessToken(customer, fastify.mongo.db);
      return sendSession(reply, { customer, token, status: 'LOGIN' });
    } catch (err) {
      request.log.error({ err: err.message, body: err.body }, 'login failed');
      return reply.code(502).send({ error: 'Could not sign you in. Please try again.' });
    }
  });

  fastify.post('/register', async (request, reply) => {
    const { firstName, lastName, acceptsMarketing, signupPath, signupSource, utms } =
      request.body || {};

    // The email comes from the signed proof, never from the body — otherwise
    // register is an open endpoint for creating verified accounts on inboxes the
    // caller does not control.
    const email = otpProof.verify(request.body?.otpProof);
    if (!email) {
      return reply.code(401).send({ error: 'Please verify your email again' });
    }

    // The mobile is NOT verified on the email path -- it is the number the delivery crew calls and
    // the Razorpay contact, so it is required, but nothing about the login depends on it.
    const mobile91 = formatMobile(request.body?.mobile);
    if (!firstName) return reply.code(400).send({ error: 'Name is required' });
    if (!mobile91) return reply.code(400).send({ error: 'Enter a valid 10-digit mobile number' });

    // Racing two registrations, or reusing a proof after the account exists, would
    // otherwise surface as a raw Shopify 422.
    const existing = await customers.findByEmail(email);
    if (existing) {
      const token = await customers.issueAccessToken(existing, fastify.mongo.db);
      return sendSession(reply, { customer: existing, token, status: 'LOGIN' });
    }
    // Shopify keeps phone numbers unique across customers. Unverified, so say it plainly rather than
    // letting Shopify's 422 decide the message.
    if (await customers.findByPhone(mobile91)) {
      return reply.code(409).send({
        error: 'That mobile number is already on another account. Log in with that account\'s email.',
      });
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
