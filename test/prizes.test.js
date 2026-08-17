// The wheel hands out money, so the pick gets checked: only winnable prizes can be
// won, the weights actually apply, and the odds never leave the server.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const prizes = require('../lib/prizes');

test('every displayed segment can actually be won', () => {
  // The whole point of the current prize table: no segment is decoration. If someone adds a
  // weight-0 prize back, this fails and the copy ("Every spin wins", "up to X off") is a lie again.
  for (const prize of prizes.PRIZES) {
    assert.ok(prize.weight > 0, `${prize.id} is displayed but unwinnable`);
  }

  // Every point in the weight space, not a sample — exhaustive and still instant.
  const seen = new Set();
  for (let roll = 0; roll < prizes.TOTAL_WEIGHT; roll++) {
    const won = prizes.pick(() => roll);
    assert.ok(won, `roll ${roll} produced nothing`);
    seen.add(won.id);
  }
  assert.equal(seen.size, prizes.PRIZES.length, 'some prize is unreachable');
});

test('the wheel cannot pay more than the copy promises', () => {
  // "up to ₹750 off" is rendered in the UI. Derive the real ceiling from the table so the two can
  // never drift: adding a ₹5,000 wedge without changing the copy fails here.
  const amounts = prizes.PRIZES.map((p) => Number(p.label.replace(/[^0-9]/g, '')));
  assert.equal(Math.max(...amounts), 750, 'copy says up to ₹750 — update both or neither');
});

test('every roll in the space maps to exactly its prize band', () => {
  let cursor = 0;
  for (const prize of prizes.PRIZES.filter((p) => p.weight > 0)) {
    for (let i = 0; i < prize.weight; i++) {
      assert.equal(prizes.pick(() => cursor).id, prize.id, `roll ${cursor}`);
      cursor++;
    }
  }
  assert.equal(cursor, prizes.TOTAL_WEIGHT, 'bands must tile the whole space');
});

test('segments sent to the browser leak no odds', () => {
  const segments = prizes.segments();
  assert.equal(segments.length, prizes.PRIZES.length, 'all segments are displayed');
  for (const segment of segments) {
    assert.deepEqual(Object.keys(segment).sort(), ['id', 'label']);
  }
});

test('every prize carries a discount code to redeem', () => {
  // A prize with no code is a promise that fails at checkout.
  for (const prize of prizes.PRIZES) {
    assert.match(prize.code, /^[A-Z0-9]+$/, `${prize.id} needs a Shopify discount code`);
  }
});
