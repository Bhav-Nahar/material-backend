const crypto = require('crypto');

// Shopify rejects a customer password over 40 characters with a 422. randomBytes(n) hex-encodes to
// 2n characters, so 16 bytes is 32 chars — under the cap with room to spare, and still 128 bits of
// entropy for a password that is generated, used once and never stored. 24 bytes (48 chars) tripped
// the limit and took down BOTH register and login, since the token rotation below uses the same call.
const PASSWORD_BYTES = 16;
const { adminGraphql, adminRest, storefrontGraphql } = require('./shopify');
const customerPassword = require('./customerPassword');
const attribution = require('./attribution');

const CUSTOMER_FIELDS = 'id email firstName lastName phone';

// Search moved to Admin GraphQL — Lucira used REST customers/search.json, which
// Shopify is retiring. `query` is a variable, so a phone number can't break out
// of the search string.
async function findByPhone(mobile91) {
  const data = await adminGraphql(
    `query findCustomer($q: String!) {
       customers(first: 1, query: $q) { nodes { ${CUSTOMER_FIELDS} } }
     }`,
    { q: `phone:+${mobile91}` },
  );
  return data?.customers?.nodes?.[0] || null;
}

async function findByEmail(email) {
  const data = await adminGraphql(
    `query findCustomer($q: String!) {
       customers(first: 1, query: $q) { nodes { ${CUSTOMER_FIELDS} } }
     }`,
    { q: `email:${JSON.stringify(email)}` },
  );
  return data?.customers?.nodes?.[0] || null;
}

const numericId = (gid) => String(gid || '').split('/').pop();

// Shopify has no "log this user in, I vouch for them" primitive outside Multipass,
// and customerAccessTokenCreate needs an email + password. So we set a throwaway
// password we alone know, immediately trade it for a token, and never keep it.
//
// ponytail: this rotates the customer's password on every login, which also
// invalidates their other sessions and costs one Admin API write on the hot path.
// It is the standard workaround for phone-OTP login on a headless Shopify store.
// Upgrade path is Multipass (Plus) or the Customer Account API — both remove this
// function entirely. Do not "fix" it piecemeal.
async function issueAccessToken(customer, db = null) {
  const numeric = Number(numericId(customer.id));

  const setPassword = async (password) => {
    await adminRest(`customers/${numericId(customer.id)}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        customer: { id: numeric, password, password_confirmation: password },
      }),
    });
  };

  const exchange = async (password) => {
    const data = await storefrontGraphql(
      `mutation login($input: CustomerAccessTokenCreateInput!) {
         customerAccessTokenCreate(input: $input) {
           customerAccessToken { accessToken expiresAt }
           customerUserErrors { code message }
         }
       }`,
      { input: { email: customer.email, password } },
    );
    return data?.customerAccessTokenCreate;
  };

  // 1. Reuse the password we already hold, so this login does NOT invalidate other sessions.
  const stored = await customerPassword.load(db, customer.id).catch(() => null);
  if (stored) {
    const result = await exchange(stored);
    if (result?.customerAccessToken?.accessToken) return result.customerAccessToken;
    // Out of sync — someone changed the password in the admin, or the record is stale. Fall through
    // and rotate, which is self-healing.
  }

  // 2. No usable password: mint one, set it on Shopify, and keep it for next time.
  const password = customerPassword.generate();
  await setPassword(password);
  await customerPassword.save(db, customer.id, password).catch(() => false);

  const result = await exchange(password);
  if (!result?.customerAccessToken?.accessToken) {
    throw new Error(result?.customerUserErrors?.[0]?.message || 'Could not create a session');
  }
  return result.customerAccessToken;
}

// REST for the same reason as the password rotation: GraphQL's CustomerInput has
// no password field, and a customer with no password can never be issued a
// storefront access token.
// Where the account came from, as Shopify customer tags. Answers "which page converted?" in the
// Shopify admin with no extra tooling — customers are filterable by tag, so `page:/products/x` is a
// segment you can read the day after launch.
//
// Tags are sanitised because Shopify splits a tag string on COMMAS: an unescaped comma in a path
// would silently become two tags. Length is capped at 255 by Shopify; 120 leaves room and keeps the
// admin readable.
const asTag = (prefix, value) => {
  const clean = String(value || '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean ? `${prefix}:${clean}` : null;
};

function signupTags({ signupPath, signupSource, acceptsMarketing, utms }) {
  return [
    'signup:web',
    asTag('page', signupPath),
    asTag('source', signupSource),
    // The campaign, if one brought them here. `page` and `source` answer which screen converted;
    // only this answers which spend earned the account, and it can be a click from weeks ago.
    ...attribution.asCustomerTags(utms),
    // WhatsApp has no consent field in Shopify — it is not a Shopify channel. A tag is what any
    // WhatsApp provider (WATI, Interakt, Gupshup) segments on, so the opt-in is recorded here and
    // the provider syncs from it.
    acceptsMarketing ? 'whatsapp:opted-in' : 'whatsapp:opted-out',
  ].filter(Boolean);
}

async function create({
  firstName,
  lastName,
  email,
  mobile91,
  acceptsMarketing,
  prize,
  signupPath,
  signupSource,
  utms,
  db = null,
}) {
  const password = crypto.randomBytes(PASSWORD_BYTES).toString('hex');
  const consentedAt = new Date().toISOString();

  const body = await adminRest('customers.json', {
    method: 'POST',
    body: JSON.stringify({
      customer: {
        first_name: firstName,
        last_name: lastName || '',
        email,
        phone: `+${mobile91}`,
        password,
        password_confirmation: password,
        verified_email: true,
        tags: signupTags({ signupPath, signupSource, acceptsMarketing, utms }).join(', '),

        // Email and SMS are real Shopify consent records, not tags — Shopify Email, Flow and any
        // SMS app read these, and marketing to a customer whose state is not "subscribed" is what
        // gets a sending domain blocked. consent_collected_from is OTHER because the opt-in happened
        // on our storefront, not in Shopify's own checkout.
        email_marketing_consent: {
          state: acceptsMarketing ? 'subscribed' : 'not_subscribed',
          opt_in_level: 'single_opt_in',
          consent_updated_at: consentedAt,
        },
        sms_marketing_consent: {
          state: acceptsMarketing ? 'subscribed' : 'not_subscribed',
          opt_in_level: 'single_opt_in',
          consent_updated_at: consentedAt,
          consent_collected_from: 'OTHER',
        },
        // Recorded on the customer so support can see what was promised, and so the same account
        // cannot re-scratch by clearing localStorage.
        //
        // A LIST, not a single value, and holding the CODE ALONE. It was `off_250|MATERIAL250` in
        // one text field, which meant anyone reading it in the admin had to know the format, and a
        // second win would have overwritten the first. `list.single_line_text_field` shows one code
        // per row in the Shopify admin, is filterable, and has somewhere to put the next one.
        ...(prize
          ? {
              metafields: [
                {
                  namespace: 'custom',
                  key: 'coupon_code',
                  value: JSON.stringify([prize.code]),
                  type: 'list.single_line_text_field',
                },
              ],
            }
          : {}),
      },
    }),
  });

  // Kept so the very first login reuses this password instead of rotating it.
  if (body?.customer?.id) {
    await customerPassword
      .save(db, `gid://shopify/Customer/${body.customer.id}`, password)
      .catch(() => false);
  }

  return body?.customer
    ? {
        id: `gid://shopify/Customer/${body.customer.id}`,
        email: body.customer.email,
        firstName: body.customer.first_name,
        lastName: body.customer.last_name,
        phone: body.customer.phone,
      }
    : null;
}

// What the frontend's userSlice actually reads. Lucira's routes returned raw
// Shopify REST customers (snake_case) from one route and GraphQL customers
// (camelCase) from another, so `loginSuccess` reads both spellings of every field.
function publicShape(customer, mobile91) {
  return {
    id: customer.id,
    email: customer.email || '',
    first_name: customer.firstName || '',
    last_name: customer.lastName || '',
    mobile: mobile91,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer',
  };
}

module.exports = { findByPhone, findByEmail, issueAccessToken, create, publicShape, numericId, signupTags };
