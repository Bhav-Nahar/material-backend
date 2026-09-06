const test = require('node:test');
const assert = require('node:assert');

const { addressKey, normalise } = require('../lib/addressMeta');

// The key must be identical whether the caller sends the full gid (old clients) or the bare
// numeric id (the frontend now strips the gid because it embeds the session's access token).
// If these ever disagree, address meta lookups silently miss and every doorstep order loses its
// floor/lift answers — the unloading charge then bills wrong.
test('full gid and bare numeric id resolve to the same key', () => {
  const gid =
    'gid://shopify/MailingAddress/11003778564233?model_name=CustomerAddress&customer_access_token=abc123';
  assert.strictEqual(addressKey(gid), '11003778564233');
  assert.strictEqual(addressKey('11003778564233'), '11003778564233');
});

test('garbage resolves to null, never a fabricated key', () => {
  assert.strictEqual(addressKey(''), null);
  assert.strictEqual(addressKey(null), null);
  assert.strictEqual(addressKey('gid://shopify/Customer/123?token=x'), null);
});

// THE ONE THAT COST MONEY. `Number(null)` and `Number('')` are both 0, and 0 is ground floor --
// the cheapest tier, quoted with full confidence and no phone call. So an unanswered floor was
// being stored as a real answer: a fifth-floor walk-up billed and dispatched as a ground-floor
// drop. The frontend sends null on purpose for "never asked"; that has to survive the round trip.
test('an unanswered floor stays unanswered -- it is not ground floor', () => {
  for (const blank of [null, undefined, '', '   ']) {
    assert.strictEqual(normalise({ floor: blank }).floor, null, `floor=${JSON.stringify(blank)}`);
  }
  // Absent key at all, e.g. a row written before these fields existed.
  assert.strictEqual(normalise({}).floor, null);
  assert.strictEqual(normalise().floor, null);
});

test('a real ground floor is still a real answer', () => {
  // The other direction, and the reason the guard cannot simply be on falsiness: somebody living
  // on the ground floor answered the question, and 0 is what they said.
  assert.strictEqual(normalise({ floor: 0 }).floor, 0);
  assert.strictEqual(normalise({ floor: '0' }).floor, 0);
});

test('a stated floor survives as a number, in range', () => {
  assert.strictEqual(normalise({ floor: 5 }).floor, 5);
  assert.strictEqual(normalise({ floor: '5' }).floor, 5);
  // Out of range or not a number is not an answer either -- same null, so it gets confirmed by
  // phone rather than multiplying a labour charge by nonsense.
  for (const bad of [-1, 101, 2.5, 'abc', NaN, true, [], {}]) {
    assert.strictEqual(normalise({ floor: bad }).floor, null, `floor=${JSON.stringify(bad)}`);
  }
});

test('lift keeps its three states', () => {
  assert.strictEqual(normalise({ liftAvailable: true }).liftAvailable, true);
  assert.strictEqual(normalise({ liftAvailable: false }).liftAvailable, false);
  assert.strictEqual(normalise({ liftAvailable: null }).liftAvailable, null);
  assert.strictEqual(normalise({}).liftAvailable, null);
});
