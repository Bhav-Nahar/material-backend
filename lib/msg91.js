// MSG91 v5 OTP API. MSG91 generates, stores, expires and verifies the OTP itself,
// so this backend keeps no OTP state of its own — nothing to store, nothing to leak.
const crypto = require('crypto');
const { fetchWithRetry } = require('./helpers');

const OTP_EXPIRY_MINUTES = 5;

// Sent explicitly rather than left to MSG91's default. The length has to match the DLT template's
// placeholder, and the frontend has to render exactly this many boxes — three places that silently
// disagree if nobody states the number. Change it here and in AuthForm's OTP_LENGTH together.
const OTP_LENGTH = 4;

// ── Test numbers ────────────────────────────────────────────────────────────────────────────────
// A fixed OTP for QA, so a signup can be run end to end without spending an SMS or waiting on a
// handset. This is a DELIBERATE BACKDOOR into any account on an allowlisted number, so:
//   - it is env-driven, never hardcoded — no test number can ship by accident
//   - it is inert unless BOTH vars are set
//   - index.js shouts about it at boot, because a backdoor nobody remembers is the dangerous kind
// Blast radius is exactly the allowlisted numbers. Do not put a real customer's number in here.
//
//   TEST_OTP_MOBILES=7021052482,9876543210
//   TEST_OTP_CODE=1111
const TEST_CODE = process.env.TEST_OTP_CODE || '';
const TEST_MOBILES = new Set(
  (process.env.TEST_OTP_MOBILES || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length === 12 && digits.startsWith('91') ? digits : '91' + digits.slice(-10);
    }),
);

const testOtpEnabled = () => Boolean(TEST_CODE && TEST_MOBILES.size);
const isTestMobile = (mobile91) => testOtpEnabled() && TEST_MOBILES.has(mobile91);

// 10-digit Indian mobile, or the same with 91/+91/spaces/dashes in front. Anything
// that isn't exactly one of those is rejected rather than coerced: Lucira's version
// ended with `'91' + cleaned.slice(-10)`, which happily turns "5" into "915" and
// spends an SMS on it.
function formatMobile(raw) {
  const cleaned = String(raw || '').replace(/\D/g, '');
  const local = cleaned.length === 12 && cleaned.startsWith('91') ? cleaned.slice(2) : cleaned;
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return '91' + local;
}

async function sendOtp(mobile91) {
  // No SMS, no cost, no MSG91 round-trip. The code is already known.
  if (isTestMobile(mobile91)) return { ok: true, body: { type: 'success', test: true } };

  const res = await fetchWithRetry('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: process.env.MSG91_AUTH_KEY },
    body: JSON.stringify({
      mobile: mobile91,
      template_id: process.env.MSG91_TEMPLATE_ID,
      otp_length: OTP_LENGTH,
      otp_expiry: OTP_EXPIRY_MINUTES,
      realTimeResponse: 1,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.type === 'success', body };
}

async function verifyOtp(mobile91, otp) {
  if (isTestMobile(mobile91)) {
    // Constant-time even here: this compares a secret, and a timing side channel does not care that
    // the secret is only a test one.
    const a = Buffer.from(String(otp));
    const b = Buffer.from(TEST_CODE);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, body: ok ? { type: 'success', test: true } : { message: 'Invalid OTP' } };
  }

  const url = `https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(mobile91)}&otp=${encodeURIComponent(otp)}`;
  const res = await fetchWithRetry(url, { headers: { authkey: process.env.MSG91_AUTH_KEY } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.type === 'success', body };
}

module.exports = {
  formatMobile,
  sendOtp,
  verifyOtp,
  isTestMobile,
  testOtpEnabled,
  TEST_MOBILES,
  OTP_EXPIRY_MINUTES,
  OTP_LENGTH,
};
