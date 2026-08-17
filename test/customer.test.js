// Shopify caps a customer password at 40 characters and answers a longer one with a 422. That broke
// register AND login on the first real run, because both mint a throwaway password the same way.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SHOPIFY_PASSWORD_MAX = 40;

test('generated passwords fit inside Shopify limit', () => {
  const src = fs.readFileSync(require.resolve('../lib/customer.js'), 'utf8');
  const bytes = Number(src.match(/const PASSWORD_BYTES = (\d+);/)?.[1]);

  assert.ok(bytes > 0, 'PASSWORD_BYTES must be declared');
  // hex encoding is two characters per byte.
  assert.ok(
    bytes * 2 <= SHOPIFY_PASSWORD_MAX,
    `randomBytes(${bytes}) hex-encodes to ${bytes * 2} chars, over Shopify's ${SHOPIFY_PASSWORD_MAX}`,
  );
  assert.ok(bytes >= 16, 'keep at least 128 bits of entropy');

  // Nothing may bypass the constant and call randomBytes with a literal again.
  const literals = [...src.matchAll(/randomBytes\((\d+)\)/g)].map((m) => m[1]);
  assert.deepEqual(literals, [], `randomBytes called with a literal: ${literals.join(', ')}`);
});

const customers = require('../lib/customer');

test('signup tags record the page and the entry point', () => {
  const tags = customers.signupTags({
    signupPath: '/products/beige-porcelain-600x600',
    signupSource: 'auto-popup',
    acceptsMarketing: true,
  });

  assert.ok(tags.includes('page:/products/beige-porcelain-600x600'));
  assert.ok(tags.includes('source:auto-popup'));
  assert.ok(tags.includes('signup:web'));
  assert.ok(tags.includes('whatsapp:opted-in'));
});

test('commas are stripped — Shopify splits a tag string on them', () => {
  // A path or source containing a comma would otherwise become two junk tags.
  const tags = customers.signupTags({
    signupPath: '/collections/tiles,laminates',
    signupSource: 'header',
    acceptsMarketing: false,
  });

  for (const tag of tags) assert.ok(!tag.includes(','), `tag "${tag}" would split`);
  assert.ok(tags.includes('whatsapp:opted-out'), 'declining is recorded, not just omitted');
});

test('tags stay inside Shopify length limits and skip empty values', () => {
  const tags = customers.signupTags({
    signupPath: '/x'.repeat(400),
    signupSource: '',
    acceptsMarketing: true,
  });

  for (const tag of tags) assert.ok(tag.length <= 255, `tag too long: ${tag.length}`);
  assert.ok(!tags.some((t) => t.startsWith('source:')), 'an empty source adds no tag');
});
