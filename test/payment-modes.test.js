const test = require('node:test');
const assert = require('node:assert/strict');

const { ADVANCE_PERCENT, advanceFor, balanceFor } = require('../lib/paymentModes');

// The one thing that must never be wrong: the two halves of a part-paid order add up to the order.
// Anything else is a customer charged twice or a driver told to collect the wrong cash.
test('the advance and the balance sum to the total', () => {
  for (const total of [999, 1000, 12345.67, 50000, 27668.4, 1]) {
    assert.equal(advanceFor(total) + balanceFor(total), Math.round(total * 100) / 100);
  }
});

test('the advance is the stated percentage, rounded to the rupee', () => {
  assert.equal(advanceFor(50000), (50000 * ADVANCE_PERCENT) / 100);
  assert.equal(advanceFor(999), Math.round((999 * ADVANCE_PERCENT) / 100));
  assert.ok(Number.isInteger(advanceFor(12345.67)));
});

// Razorpay refuses anything under ₹1, so an advance can never round down to nothing.
test('the advance never rounds to zero', () => {
  assert.equal(advanceFor(1), 1);
  assert.equal(advanceFor(0.5), 1);
});
