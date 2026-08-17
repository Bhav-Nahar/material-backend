// Proof that *this* mobile passed OTP, handed to the client when verify-otp finds
// no existing customer and required back by /register.
//
// Lucira's recovered register route took `mobile` straight from the request body
// with no OTP check anywhere, so anyone could POST and create a verified Shopify
// customer on someone else's number. Register now trusts only the number inside
// this token, never the body.
//
// Stateless on purpose: an HMAC over "mobile.expiry" needs no store, which keeps
// this backend database-free.
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;

const secret = () => {
  const s = process.env.OTP_PROOF_SECRET;
  if (!s) throw new Error('OTP_PROOF_SECRET not configured');
  return s;
};

const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');

function issue(mobile91, now = Date.now()) {
  const payload = `${mobile91}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the mobile the token vouches for, or null. Compares in constant time so
// the signature can't be recovered a byte at a time.
function verify(token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const [mobile, expiry, sig] = parts;
  const expected = sign(`${mobile}.${expiry}`);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number(expiry) || Number(expiry) < now) return null;

  return mobile;
}

module.exports = { issue, verify, TTL_MS };
