// The fixed-OTP backdoor. Tested because a bypass that silently applies to the wrong number, or
// stays on when unconfigured, is the worst possible bug in this file.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const MODULE = require.resolve('../lib/msg91');
const fresh = (env) => {
  delete require.cache[MODULE];
  Object.assign(process.env, env);
  return require('../lib/msg91');
};

test('inert unless both vars are set', () => {
  assert.equal(fresh({ TEST_OTP_MOBILES: '', TEST_OTP_CODE: '' }).testOtpEnabled(), false);
  assert.equal(fresh({ TEST_OTP_MOBILES: '7021052482', TEST_OTP_CODE: '' }).testOtpEnabled(), false);
  assert.equal(fresh({ TEST_OTP_MOBILES: '', TEST_OTP_CODE: '1111' }).testOtpEnabled(), false);
  assert.equal(fresh({ TEST_OTP_MOBILES: '7021052482', TEST_OTP_CODE: '1111' }).testOtpEnabled(), true);
});

test('matches the allowlisted number in every format, and nothing else', () => {
  const m = fresh({ TEST_OTP_MOBILES: '7021052482', TEST_OTP_CODE: '1111' });

  assert.equal(m.isTestMobile('917021052482'), true);
  // A real customer's number must never take the bypass.
  assert.equal(m.isTestMobile('919876543210'), false);
  assert.equal(m.isTestMobile('917021052483'), false, 'one digit off is not the test number');
});

test('the fixed code verifies and a wrong one does not', async () => {
  const m = fresh({ TEST_OTP_MOBILES: '+91 70210 52482', TEST_OTP_CODE: '1111' });

  assert.equal((await m.verifyOtp('917021052482', '1111')).ok, true);
  assert.equal((await m.verifyOtp('917021052482', '1112')).ok, false);
  assert.equal((await m.verifyOtp('917021052482', '11111')).ok, false, 'length must match');
  assert.equal((await m.verifyOtp('917021052482', '')).ok, false);
});

test('sending to a test number costs no SMS', async () => {
  const m = fresh({ TEST_OTP_MOBILES: '7021052482', TEST_OTP_CODE: '1111' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('MSG91 must not be called for a test number');
  try {
    assert.equal((await m.sendOtp('917021052482')).ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
