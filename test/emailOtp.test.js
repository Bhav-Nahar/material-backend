// The email OTP check: who gets in on which code. A tiny in-memory stand-in for the one Mongo
// collection, and the dev "log instead of email" mode to read the code back. No network.
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.OTP_PROOF_SECRET = 'test-secret-not-a-real-one';
delete process.env.RESEND_API_KEY;
process.env.NODE_ENV = 'test';

const otp = require('../lib/emailOtp');

function fakeDb() {
  const docs = new Map();
  const col = {
    createIndex: async () => {},
    findOne: async ({ _id }) => docs.get(_id) || null,
    deleteOne: async ({ _id }) => docs.delete(_id),
    updateOne: async ({ _id }, { $set }) => docs.set(_id, { ...(docs.get(_id) || { _id }), ...$set }),
  };
  return { docs, collection: () => col };
}

async function send(email, db) {
  let code = null;
  const log = { warn: (msg) => (code = msg.split(': ').pop()) };
  assert.equal((await otp.sendOtp(email, db, log)).ok, true);
  return code;
}

test('normalizeEmail folds case and whitespace, rejects junk', () => {
  assert.equal(otp.normalizeEmail('  Rohan@Gmail.COM '), 'rohan@gmail.com');
  for (const bad of ['', null, 'rohan', 'rohan@', 'rohan@gmail', 'a b@c.com']) {
    assert.equal(otp.normalizeEmail(bad), null, JSON.stringify(bad));
  }
});

test('the emailed code verifies once, and only once', async () => {
  const db = fakeDb();
  const code = await send('a@b.co', db);
  assert.match(code, new RegExp(`^\\d{${otp.OTP_LENGTH}}$`));
  assert.equal(db.docs.get('a@b.co').hash.includes(code), false, 'stored hashed, not plain');

  assert.equal((await otp.verifyOtp('a@b.co', code, db)).ok, true);
  assert.equal((await otp.verifyOtp('a@b.co', code, db)).ok, false, 'second use');
});

test('a code is for its own address only', async () => {
  const db = fakeDb();
  const code = await send('a@b.co', db);
  await send('c@d.co', db);
  assert.equal((await otp.verifyOtp('c@d.co', code, db)).ok, false);
});

test('wrong guesses burn the code after MAX_ATTEMPTS', async () => {
  const db = fakeDb();
  const code = await send('a@b.co', db);
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < otp.MAX_ATTEMPTS; i++) await otp.verifyOtp('a@b.co', wrong, db);
  assert.equal((await otp.verifyOtp('a@b.co', code, db)).ok, false, 'right code after lockout');
});

test('an expired code fails even before Mongo sweeps it', async () => {
  const db = fakeDb();
  const code = await send('a@b.co', db);
  db.docs.get('a@b.co').expiresAt = new Date(Date.now() - 1000);
  assert.equal((await otp.verifyOtp('a@b.co', code, db)).ok, false);
});

test('a new send replaces the old code', async () => {
  const db = fakeDb();
  const first = await send('a@b.co', db);
  const second = await send('a@b.co', db);
  if (first !== second) assert.equal((await otp.verifyOtp('a@b.co', first, db)).ok, false);
  assert.equal((await otp.verifyOtp('a@b.co', second, db)).ok, true);
});
