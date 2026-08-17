// The Admin token cache. Gets its own file because each test needs a fresh module
// (the cache is module-level state), which means fiddling with require.cache.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
process.env.SHOPIFY_CLIENT_ID = 'cid';
process.env.SHOPIFY_CLIENT_SECRET = 'csecret';

const MODULE = require.resolve('../lib/adminToken');
const realFetch = globalThis.fetch;

let calls;
const freshModule = () => {
  delete require.cache[MODULE];
  return require('../lib/adminToken');
};

const stubFetch = (handler) => {
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return handler(calls.length);
  };
};

const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('mints a token and sends the client credentials grant', async () => {
  stubFetch(() => jsonRes({ access_token: 'shpca_first', expires_in: 86399 }));
  const { getAdminToken } = freshModule();

  assert.equal(await getAdminToken(), 'shpca_first');
  assert.equal(calls.length, 1);

  const [url, opts] = calls[0];
  assert.equal(url, 'https://test.myshopify.com/admin/oauth/access_token');
  assert.deepEqual(JSON.parse(opts.body), {
    client_id: 'cid',
    client_secret: 'csecret',
    grant_type: 'client_credentials',
  });
});

test('caches — a second call does not hit Shopify again', async () => {
  stubFetch((n) => jsonRes({ access_token: `shpca_${n}`, expires_in: 86399 }));
  const { getAdminToken } = freshModule();

  assert.equal(await getAdminToken(), 'shpca_1');
  assert.equal(await getAdminToken(), 'shpca_1');
  assert.equal(calls.length, 1, 'one network call for two gets');
});

test('re-mints when the cached token is inside the expiry skew', async () => {
  // 30s left, skew is 60s — treat as already gone rather than race it.
  stubFetch((n) => jsonRes({ access_token: `shpca_${n}`, expires_in: 30 }));
  const { getAdminToken } = freshModule();

  assert.equal(await getAdminToken(), 'shpca_1');
  assert.equal(await getAdminToken(), 'shpca_2', 'refetched');
  assert.equal(calls.length, 2);
});

test('concurrent misses share one request', async () => {
  stubFetch((n) => jsonRes({ access_token: `shpca_${n}`, expires_in: 86399 }));
  const { getAdminToken } = freshModule();

  const tokens = await Promise.all([getAdminToken(), getAdminToken(), getAdminToken()]);
  assert.deepEqual(tokens, ['shpca_1', 'shpca_1', 'shpca_1']);
  assert.equal(calls.length, 1, 'no stampede');
});

test('invalidate() forces a fresh mint', async () => {
  stubFetch((n) => jsonRes({ access_token: `shpca_${n}`, expires_in: 86399 }));
  const { getAdminToken, invalidate } = freshModule();

  assert.equal(await getAdminToken(), 'shpca_1');
  invalidate();
  assert.equal(await getAdminToken(), 'shpca_2');
});

test('a failed mint throws and does not poison the next attempt', async () => {
  stubFetch((n) =>
    n === 1
      ? jsonRes({ errors: 'invalid_client' }, 401)
      : jsonRes({ access_token: 'shpca_ok', expires_in: 86399 }),
  );
  const { getAdminToken } = freshModule();

  await assert.rejects(() => getAdminToken(), /Could not get a Shopify Admin token \(401\)/);
  assert.equal(await getAdminToken(), 'shpca_ok', 'retry works after a failure');
});
