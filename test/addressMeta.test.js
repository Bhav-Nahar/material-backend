const test = require('node:test');
const assert = require('node:assert');

const { addressKey } = require('../lib/addressMeta');

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
