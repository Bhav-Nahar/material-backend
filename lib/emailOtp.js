// Email OTP, delivered by Resend. Replaces MSG91 SMS until Texture House has its own DLT
// registration -- see lib/msg91.js and routes/auth-sms.js, kept for that day.
//
// WHY THIS FILE HOLDS STATE AND msg91.js DID NOT. MSG91 generated, stored and verified the code
// itself. Resend only delivers email, so the code is ours to mint, keep and check. Kept in Mongo
// (`email_otps`, one doc per address, TTL-indexed) so it survives a restart and works across
// instances, and stored as an HMAC, never the code itself -- a dump of the collection is not a
// list of live login codes.
//
// GUESSING. A 6-digit code is a million options; the per-IP rate limit alone does not stop someone
// cycling IPs against one inbox. So each code allows MAX_ATTEMPTS wrong guesses and then dies, and a
// fresh one costs a send, which smsThrottle (keyed by address here) caps at 5 a day.
const crypto = require('crypto');
const { fetchWithRetry } = require('./helpers');

const OTP_LENGTH = 6; // AuthForm's OTP_LENGTH must match
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const COLLECTION = 'email_otps';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Lowercased and trimmed so "Rohan@Gmail.com " and "rohan@gmail.com" are one inbox, one throttle
// and one account. Anything that does not look like an address is rejected rather than "fixed".
function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

// ── Test addresses ───────────────────────────────────────────────────────────────────────────────
// Same deliberate backdoor as msg91's TEST_OTP_MOBILES: a fixed code for QA, inert unless BOTH vars
// are set, announced at boot by index.js. Never list a real customer's address.
//   TEST_OTP_EMAILS=qa@texturehouse.in
//   TEST_OTP_CODE=111111
const TEST_CODE = process.env.TEST_OTP_CODE || '';
const TEST_EMAILS = new Set(
  (process.env.TEST_OTP_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean),
);
const testOtpEnabled = () => Boolean(TEST_CODE && TEST_EMAILS.size);
const isTestEmail = (email) => testOtpEnabled() && TEST_EMAILS.has(email);

// Local development without a Resend key: the code goes to the server log instead of an inbox.
// Never in production -- there a missing key is a failed send, not a code printed to the logs.
const logOnly = () => !process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production';

const hash = (email, code) =>
  crypto
    .createHmac('sha256', process.env.OTP_PROOF_SECRET || '')
    .update(`${email}:${code}`)
    .digest('hex');

const generate = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

let indexed = false;
async function otps(db) {
  const col = db.collection(COLLECTION);
  if (!indexed) {
    // Mongo deletes each doc once expiresAt passes. Idempotent, so running it once per process is
    // enough; a failure is retried on the next send.
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    indexed = true;
  }
  return col;
}

function emailBody(code) {
  const text =
    `Your Texture House login code is ${code}.\n\n` +
    `It expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not ask for it, ignore this email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1c1b1a">
  <p style="margin:0 0 20px;font-weight:700;font-size:18px;letter-spacing:-0.02em;color:#e4551a;text-transform:uppercase">Texture House</p>
  <p style="margin:0 0 12px;font-size:15px">Your login code:</p>
  <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace">${code}</p>
  <p style="margin:0;font-size:13px;color:#6b6b6b">It expires in ${OTP_EXPIRY_MINUTES} minutes. If you did not ask for it, ignore this email.</p>
</div>`;
  return { text, html };
}

/**
 * @returns {{ ok: boolean, body?: object }} `ok: false` means nothing was sent.
 */
async function sendOtp(email, db, log = console) {
  if (isTestEmail(email)) return { ok: true, body: { test: true } };
  if (!db) return { ok: false, body: { error: 'database unavailable' } };

  const code = generate();
  await (await otps(db)).updateOne(
    { _id: email },
    {
      $set: {
        hash: hash(email, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    },
    { upsert: true },
  );

  if (logOnly()) {
    log.warn(`[email OTP, dev only -- RESEND_API_KEY unset] ${email}: ${code}`);
    return { ok: true, body: { devLog: true } };
  }

  const { text, html } = emailBody(code);
  const res = await fetchWithRetry('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      // fetchWithRetry repeats a POST on a 5xx; the key makes Resend deliver it once.
      'Idempotency-Key': hash(email, code).slice(0, 48),
    },
    body: JSON.stringify({
      from: process.env.OTP_FROM_EMAIL || 'Texture House <login@texturehouse.in>',
      to: [email],
      subject: `${code} is your Texture House login code`,
      text,
      html,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

/**
 * One use per code: a match deletes it. A miss counts against MAX_ATTEMPTS, after which the code is
 * gone and a new one has to be requested.
 */
async function verifyOtp(email, otp, db) {
  const code = String(otp || '');
  if (isTestEmail(email)) {
    // Constant-time even for the test code: it is still a secret.
    const a = Buffer.from(code);
    const b = Buffer.from(TEST_CODE);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, body: ok ? { test: true } : { message: 'Invalid OTP' } };
  }
  if (!db) return { ok: false, body: { message: 'Could not check the code. Please try again.' } };
  if (code.length !== OTP_LENGTH) return { ok: false, body: { message: 'Invalid OTP' } };

  const col = await otps(db);
  const doc = await col.findOne({ _id: email });
  // The TTL monitor only sweeps once a minute, so expiry is checked here too.
  if (!doc || doc.expiresAt < new Date()) {
    return { ok: false, body: { message: 'That code has expired. Request a new one.' } };
  }

  const a = Buffer.from(hash(email, code));
  const b = Buffer.from(doc.hash);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    await col.deleteOne({ _id: email });
    return { ok: true, body: {} };
  }

  const attempts = (doc.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await col.deleteOne({ _id: email });
    return { ok: false, body: { message: 'Too many wrong codes. Request a new one.' } };
  }
  await col.updateOne({ _id: email }, { $set: { attempts } });
  return { ok: false, body: { message: 'Invalid OTP' } };
}

module.exports = {
  normalizeEmail,
  sendOtp,
  verifyOtp,
  isTestEmail,
  testOtpEnabled,
  logOnly,
  TEST_EMAILS,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  MAX_ATTEMPTS,
};
