// Covers the three bits of logic that decide who gets an account: mobile
// normalisation, the OTP proof that gates /register, and the SMS throttle.
// No network, no Shopify, no MSG91.
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.OTP_PROOF_SECRET = 'test-secret-not-a-real-one';

const { formatMobile } = require('../lib/msg91');
const otpProof = require('../lib/otpProof');
const smsThrottle = require('../lib/smsThrottle');

test('formatMobile normalises the shapes a form actually produces', () => {
  for (const input of ['9876543210', '+91 98765 43210', '91-9876543210', '919876543210']) {
    assert.equal(formatMobile(input), '919876543210', input);
  }
});

test('formatMobile rejects rather than coerces junk', () => {
  // Lucira's version ended in `'91' + cleaned.slice(-10)`, so every one of these
  // became a "valid" number and spent an SMS.
  for (const input of ['5', '', null, undefined, '12345', '1234567890', '98765432101']) {
    assert.equal(formatMobile(input), null, JSON.stringify(input));
  }
});

test('otpProof round-trips the number it was issued for', () => {
  assert.equal(otpProof.verify(otpProof.issue('919876543210')), '919876543210');
});

test('otpProof rejects a tampered number, a bad signature, and expiry', () => {
  const token = otpProof.issue('919876543210');
  const [mobile, expiry, sig] = token.split('.');

  assert.equal(otpProof.verify(`919999999999.${expiry}.${sig}`), null, 'swapped number');
  assert.equal(otpProof.verify(`${mobile}.${expiry}.${'0'.repeat(sig.length)}`), null, 'forged sig');
  assert.equal(otpProof.verify(`${mobile}.${Number(expiry) + 60000}.${sig}`), null, 'extended expiry');
  assert.equal(otpProof.verify('garbage'), null, 'malformed');
  assert.equal(otpProof.verify(''), null, 'empty');

  const stale = otpProof.issue('919876543210', Date.now() - otpProof.TTL_MS - 1000);
  assert.equal(otpProof.verify(stale), null, 'expired');
});

test('smsThrottle enforces cooldown then a daily cap', () => {
  const phone = '919000000001';
  const t0 = 1_700_000_000_000;

  assert.equal(smsThrottle.check(phone, t0), null, 'first send allowed');
  smsThrottle.record(phone, t0);

  assert.equal(smsThrottle.check(phone, t0 + 1000)?.reason, 'cooldown');
  assert.equal(smsThrottle.check(phone, t0 + 61_000), null, 'allowed after cooldown');

  // Burn the rest of the daily allowance, one per cooldown window.
  let now = t0;
  for (let i = 1; i < smsThrottle.DAILY_LIMIT; i++) {
    now += smsThrottle.COOLDOWN_MS + 1;
    smsThrottle.record(phone, now);
  }
  assert.equal(smsThrottle.check(phone, now + smsThrottle.COOLDOWN_MS + 1)?.reason, 'daily_limit');

  // ...and the window rolls forward rather than locking the number out forever.
  assert.equal(smsThrottle.check(phone, t0 + 24 * 60 * 60 * 1000 + 1), null, 'next day allowed');
});
