const { fetchWithRetry } = require('./helpers');
const { getAdminToken, invalidate } = require('./adminToken');

const rawStore = process.env.SHOPIFY_STORE_DOMAIN || '';
const SHOP_DOMAIN = rawStore.includes('.') ? rawStore : rawStore + '.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

// One 401 retry, on a freshly minted token. A cached token can be invalidated
// before its stated expiry — app reinstalled, scopes changed — and the whole point
// of minting them here is that recovering costs nothing.
async function withAdminToken(send) {
  let res = await send(await getAdminToken());
  if (res.status === 401) {
    invalidate();
    res = await send(await getAdminToken({ force: true }));
  }
  return res;
}

// Every GraphQL call passes user input through `variables`, never string
// interpolation. Lucira's recovered verify-otp built its mutation by splicing the
// customer email straight into the query text, which is a GraphQL injection.
async function adminGraphql(query, variables = {}) {
  const res = await withAdminToken((token) =>
    fetchWithRetry(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    }),
  );

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Shopify Admin ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  if (body?.errors) throw new Error(body.errors[0]?.message || 'Shopify GraphQL error');
  return body.data;
}

async function storefrontGraphql(query, variables = {}) {
  if (!process.env.SHOPIFY_STOREFRONT_TOKEN) throw new Error('SHOPIFY_STOREFRONT_TOKEN not configured');

  const res = await fetchWithRetry(
    `https://${SHOP_DOMAIN}/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Shopify Storefront ${res.status}`);
  if (body?.errors) throw new Error(body.errors[0]?.message || 'Shopify GraphQL error');
  return body.data;
}

// ponytail: REST, deliberately. Admin GraphQL's CustomerInput has no `password`
// field at all, so customer creation and the password rotation below cannot be
// expressed in GraphQL — reads move, writes can't. Shopify is retiring REST
// customer endpoints; the upgrade is Multipass (Plus) or the Customer Account
// API, both of which replace the whole rotate-password dance in `issueAccessToken`.
async function adminRest(path, options = {}) {
  const res = await withAdminToken((token) =>
    fetchWithRetry(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        ...(options.headers || {}),
      },
    }),
  );

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.errors ? JSON.stringify(body.errors) : String(res.status);
    const err = new Error(`Shopify Admin REST ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

module.exports = { adminGraphql, storefrontGraphql, adminRest, SHOP_DOMAIN, API_VERSION };
