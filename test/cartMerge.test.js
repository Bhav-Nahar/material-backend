// linesToCopy decides what a cross-device login moves between carts. Getting it
// wrong changes what the customer is charged, so it gets its own checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { linesToCopy } = require('../lib/shopifyCart');

const cart = (...lines) => ({
  lines: {
    nodes: lines.map(([id, quantity, attributes]) => ({
      quantity,
      merchandise: { id },
      ...(attributes ? { attributes } : {}),
    })),
  },
});

test('copies lines the target does not have', () => {
  const from = cart(['variant/A', 2], ['variant/B', 1]);
  const into = cart(['variant/A', 5]);

  assert.deepEqual(linesToCopy(from, into), [{ merchandiseId: 'variant/B', quantity: 1 }]);
});

test('does not sum quantities for a variant already in the target', () => {
  // 3 boxes on the phone and 3 on the laptop is the same intent twice, not 6.
  const from = cart(['variant/A', 3]);
  const into = cart(['variant/A', 3]);

  assert.deepEqual(linesToCopy(from, into), []);
});

test('carries line attributes across', () => {
  const attributes = [{ key: 'Area', value: '12 sqm' }];
  const from = cart(['variant/A', 1, attributes]);

  assert.deepEqual(linesToCopy(from, cart()), [
    { merchandiseId: 'variant/A', quantity: 1, attributes },
  ]);
});

test('empty and missing carts are not errors', () => {
  assert.deepEqual(linesToCopy(cart(), cart(['variant/A', 1])), []);
  assert.deepEqual(linesToCopy(null, null), []);
  assert.deepEqual(linesToCopy(cart(['variant/A', 1]), null), [
    { merchandiseId: 'variant/A', quantity: 1 },
  ]);
});

test('skips lines whose merchandise Shopify could not resolve', () => {
  // A deleted variant comes back as merchandise: null; sending it would fail the
  // whole cartLinesAdd and lose the rest of the merge.
  const from = { lines: { nodes: [{ quantity: 1, merchandise: null }, { quantity: 2, merchandise: { id: 'variant/B' } }] } };

  assert.deepEqual(linesToCopy(from, cart()), [{ merchandiseId: 'variant/B', quantity: 2 }]);
});
