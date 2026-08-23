// Profile, orders and addresses.
//
// STOREFRONT API, not Admin. Everything here is the signed-in customer acting on their own data, and
// the Storefront API scopes every call to the access token they already hold — so a customer
// physically cannot read or edit someone else's record, whatever they put in the request body. The
// Admin API would happily let them, and then correctness would depend on us checking an id on every
// route. Lucira's recovered addresses route is 408 lines largely because it mixes both.
const { bearer } = require('../lib/auth');
const { adminGraphql, storefrontGraphql } = require('../lib/shopify');
const addressMeta = require('../lib/addressMeta');

const ADDRESS_FIELDS = `
  id firstName lastName company
  address1 address2 city province zip country phone
`;

// Shopify returns the customer's own errors (bad zip, missing field) separately from transport
// errors. They are written for shoppers, so they are passed through as-is.
const userError = (result) => result?.customerUserErrors?.[0]?.message || null;

const asAddressInput = (a = {}) => ({
  firstName: a.firstName || '',
  lastName: a.lastName || '',
  company: a.company || '',
  address1: a.address1 || '',
  address2: a.address2 || '',
  city: a.city || '',
  province: a.province || '',
  zip: a.zip || '',
  country: a.country || 'India',
  phone: a.phone || '',
});

module.exports = async function customerRoutes(fastify) {
  // Every route here is the customer's own data. No guests.
  fastify.addHook('preHandler', fastify.requireCustomer);

  fastify.get('/profile', async (request, reply) => {
    const data = await storefrontGraphql(
      `query me($token: String!) {
         customer(customerAccessToken: $token) {
           id firstName lastName email phone
           defaultAddress { id }
         }
       }`,
      { token: bearer(request) },
    );
    if (!data?.customer) return reply.code(401).send({ error: 'Please sign in again' });
    return { customer: data.customer };
  });

  fastify.patch('/profile', async (request, reply) => {
    const { firstName, lastName, email } = request.body || {};

    const data = await storefrontGraphql(
      `mutation update($token: String!, $customer: CustomerUpdateInput!) {
         customerUpdate(customerAccessToken: $token, customer: $customer) {
           customer { id firstName lastName email phone }
           customerUserErrors { message }
         }
       }`,
      {
        token: bearer(request),
        // Only the fields sent. Passing an empty string for an untouched field would blank it.
        customer: {
          ...(firstName !== undefined ? { firstName } : {}),
          ...(lastName !== undefined ? { lastName } : {}),
          ...(email !== undefined ? { email } : {}),
        },
      },
    );

    const result = data?.customerUpdate;
    const err = userError(result);
    if (err) return reply.code(400).send({ error: err });
    return { customer: result.customer };
  });

  // Shopify's own order history. We do NOT read the local `orders` mirror here — that exists to
  // reconcile payments, and Shopify is the record the customer should be shown.
  fastify.get('/orders', async (request, reply) => {
    const data = await storefrontGraphql(
      `query orders($token: String!) {
         customer(customerAccessToken: $token) {
           orders(first: 25, sortKey: PROCESSED_AT, reverse: true) {
             nodes {
               id name processedAt statusUrl
               financialStatus fulfillmentStatus
               currentTotalPrice { amount currencyCode }
               lineItems(first: 4) {
                 nodes {
                   title quantity
                   variant { image { url } }
                 }
               }
             }
           }
         }
       }`,
      { token: bearer(request) },
    );
    if (!data?.customer) return reply.code(401).send({ error: 'Please sign in again' });
    return { orders: data.customer.orders?.nodes || [] };
  });

  fastify.get('/addresses', async (request, reply) => {
    const data = await storefrontGraphql(
      `query addresses($token: String!) {
         customer(customerAccessToken: $token) {
           defaultAddress { id }
           addresses(first: 20) { nodes { ${ADDRESS_FIELDS} } }
         }
       }`,
      { token: bearer(request) },
    );
    if (!data?.customer) return reply.code(401).send({ error: 'Please sign in again' });

    // Shopify holds the postal address; the floor/lift attributes are ours, joined on the id.
    const meta = await addressMeta.loadMany(fastify.mongo.db, request.customer.id);

    return {
      addresses: (data.customer.addresses?.nodes || []).map((a) => ({
        ...a,
        ...(meta.get(addressMeta.addressKey(a.id)) || {
          propertyType: null,
          floor: null,
          liftAvailable: null,
        }),
      })),
      defaultAddressId: data.customer.defaultAddress?.id || null,
      propertyTypes: addressMeta.PROPERTY_TYPES,
    };
  });

  fastify.post('/addresses', async (request, reply) => {
    const { address, makeDefault } = request.body || {};
    const token = bearer(request);

    const data = await storefrontGraphql(
      `mutation create($token: String!, $address: MailingAddressInput!) {
         customerAddressCreate(customerAccessToken: $token, address: $address) {
           customerAddress { ${ADDRESS_FIELDS} }
           customerUserErrors { message }
         }
       }`,
      { token, address: asAddressInput(address) },
    );

    const result = data?.customerAddressCreate;
    const err = userError(result);
    if (err) return reply.code(400).send({ error: err });

    // A customer's first address should be their default without them having to ask.
    const created = result.customerAddress;
    if (makeDefault && created?.id) await setDefault(token, created.id);

    // Only possible after Shopify hands back an id — that id is the join key.
    await addressMeta.save(fastify.mongo.db, request.customer.id, created?.id, address || {});

    return { address: { ...created, ...addressMeta.normalise(address || {}) } };
  });

  fastify.patch('/addresses', async (request, reply) => {
    const { addressId, address, mode } = request.body || {};
    const token = bearer(request);
    if (!addressId) return reply.code(400).send({ error: 'addressId is required' });

    if (mode === 'default') {
      const err = await setDefault(token, addressId);
      if (err) return reply.code(400).send({ error: err });
      return { defaultAddressId: addressId };
    }

    const data = await storefrontGraphql(
      `mutation update($token: String!, $id: ID!, $address: MailingAddressInput!) {
         customerAddressUpdate(customerAccessToken: $token, id: $id, address: $address) {
           customerAddress { ${ADDRESS_FIELDS} }
           customerUserErrors { message }
         }
       }`,
      { token, id: addressId, address: asAddressInput(address) },
    );

    const result = data?.customerAddressUpdate;
    const err = userError(result);
    if (err) return reply.code(400).send({ error: err });

    // Shopify mints a NEW id on update, so the meta moves with it and the old row is dropped.
    const updated = result.customerAddress;
    if (updated?.id && updated.id !== addressId) {
      await addressMeta.remove(fastify.mongo.db, request.customer.id, addressId);
    }
    await addressMeta.save(fastify.mongo.db, request.customer.id, updated?.id, address || {});

    return { address: { ...updated, ...addressMeta.normalise(address || {}) } };
  });

  fastify.delete('/addresses', async (request, reply) => {
    const addressId = request.query?.addressId;
    if (!addressId) return reply.code(400).send({ error: 'addressId is required' });

    const data = await storefrontGraphql(
      `mutation remove($token: String!, $id: ID!) {
         customerAddressDelete(customerAccessToken: $token, id: $id) {
           deletedCustomerAddressId
           customerUserErrors { message }
         }
       }`,
      { token: bearer(request), id: addressId },
    );

    const result = data?.customerAddressDelete;
    const err = userError(result);
    if (err) return reply.code(400).send({ error: err });

    await addressMeta.remove(fastify.mongo.db, request.customer.id, addressId);
    return { deletedId: result.deletedCustomerAddressId };
  });

  // GET|PUT /api/customer/pincode — the customer's delivery pincode, on `custom.pincode`.
  //
  // WHY A METAFIELD AND NOT AN ADDRESS. A pincode is not an address: it is entered before anyone is
  // willing to type a house number, it is the answer to "do you even deliver to me", and it has to
  // survive on a device where localStorage was cleared. Writing it as a draft address would put a
  // half-empty address in the customer's account and in the Shopify admin's address book, which is
  // where real shipping addresses live and where an operator reasonably trusts what they read.
  //
  // ADMIN API, for the same reason as /coupons above: metafields are not writable through the
  // Storefront API. The id is not user input -- Shopify resolved it from the customer's own access
  // token -- so a customer cannot point this at someone else's record.
  //
  // SINGLE_LINE_TEXT_FIELD, not number_integer. Indian pincodes are six-digit strings and the first
  // digit is never 0, but they are identifiers, not quantities: nothing adds them up, and as an
  // integer the admin would right-align them and offer to sum a column of them.
  fastify.get('/pincode', async (request) => {
    const owned = await adminGraphql(
      `query pin($id: ID!) {
         customer(id: $id) { metafield(namespace: "custom", key: "pincode") { value } }
       }`,
      { id: request.customer.id },
    ).catch(() => null);

    return { pincode: owned?.customer?.metafield?.value || '' };
  });

  fastify.put('/pincode', async (request, reply) => {
    const pincode = String(request.body?.pincode ?? '').trim();

    // VALIDATED HERE and not only in the browser. This is a trust boundary: the route is reachable
    // with any body, and a metafield is read back by the storefront and by whoever is looking at the
    // customer in the admin. Six digits, first one non-zero -- the same test lib/delivery.js runs on
    // the client, because two different definitions of "valid pincode" is one definition too many.
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      return reply.code(400).send({ error: 'Enter a valid 6-digit pincode' });
    }

    const result = await adminGraphql(
      `mutation setPin($metafields: [MetafieldsSetInput!]!) {
         metafieldsSet(metafields: $metafields) {
           metafields { value }
           userErrors { field message }
         }
       }`,
      {
        metafields: [
          {
            ownerId: request.customer.id,
            namespace: 'custom',
            key: 'pincode',
            type: 'single_line_text_field',
            value: pincode,
          },
        ],
      },
    );

    const error = result?.metafieldsSet?.userErrors?.[0]?.message;
    if (error) return reply.code(422).send({ error });

    return { pincode };
  });

  // GET /api/customer/coupons — what this customer has won, and whether it is still spendable.
  //
  // ADMIN API for the codes, keyed by the id inside the customer's own access token. The metafield
  // and the discount terms are not exposed to the Storefront API, and the id is not user input --
  // Shopify resolved it from the token -- so there is nothing here a customer could point at someone
  // else's record.
  fastify.get('/coupons', async (request, reply) => {
    const customerId = request.customer.id;

    const owned = await adminGraphql(
      `query prizes($id: ID!) {
         customer(id: $id) { metafield(namespace: "custom", key: "coupon_code") { value } }
       }`,
      { id: customerId },
    ).catch(() => null);

    let codes = [];
    try {
      codes = JSON.parse(owned?.customer?.metafield?.value || '[]');
    } catch {
      codes = [];
    }
    if (!codes.length) return { coupons: [] };

    // Which codes this customer has already spent. Shopify counts redemptions per code globally, not
    // per customer, so the only honest source is the customer's own orders — a code sitting on a past
    // order of theirs is one they cannot use again (every code is appliesOncePerCustomer).
    const history = await storefrontGraphql(
      `query used($token: String!) {
         customer(customerAccessToken: $token) {
           orders(first: 50) {
             nodes {
               name
               discountApplications(first: 5) {
                 nodes { ... on DiscountCodeApplication { code } }
               }
             }
           }
         }
       }`,
      { token: bearer(request) },
    ).catch(() => null);

    const spentOn = new Map();
    for (const order of history?.customer?.orders?.nodes || []) {
      for (const d of order.discountApplications?.nodes || []) {
        if (d?.code) spentOn.set(d.code.toUpperCase(), order.name);
      }
    }

    // Terms come from Shopify, never from a table here — the same reason the cart asks Shopify
    // whether a code applies. Edit the discount in the admin and this page follows.
    //
    // FETCHED IN ONE CALL AND MATCHED HERE, rather than one `query: "code:X"` search per coupon.
    // That search is not reliable: it misses codes created seconds ago (it is eventually consistent)
    // and it matched the WRONG discount for MATERIAL300 — returning null terms and status false for
    // a code that is demonstrably active. Reading the list and comparing exactly is both correct and
    // fewer round trips. A storefront has tens of discounts, not thousands.
    const all = await adminGraphql(
      `query allDiscounts {
         codeDiscountNodes(first: 100) {
           nodes { codeDiscount { ... on DiscountCodeBasic {
             status endsAt
             codes(first: 1) { nodes { code } }
             customerGets { value { ... on DiscountAmount { amount { amount } } } }
             minimumRequirement { ... on DiscountMinimumSubtotal {
               greaterThanOrEqualToSubtotal { amount } } }
           } } }
         }
       }`,
    ).catch(() => null);

    const terms = new Map();
    for (const node of all?.codeDiscountNodes?.nodes || []) {
      const d = node.codeDiscount;
      const code = d?.codes?.nodes?.[0]?.code;
      if (code) terms.set(code.toUpperCase(), d);
    }

    const coupons = codes.map((code) => {
      const d = terms.get(String(code).toUpperCase());
      const usedOnOrder = spentOn.get(String(code).toUpperCase()) || null;

      return {
        code,
        amount: Number(d?.customerGets?.value?.amount?.amount ?? 0) || null,
        minimumSubtotal:
          Number(d?.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount ?? 0) || null,
        // A code the merchant has since disabled must not look spendable.
        active: d ? d.status === 'ACTIVE' : false,
        expiresAt: d?.endsAt ?? null,
        used: Boolean(usedOnOrder),
        usedOnOrder,
      };
    });

    return { coupons };
  });

  async function setDefault(token, addressId) {
    const data = await storefrontGraphql(
      `mutation makeDefault($token: String!, $id: ID!) {
         customerDefaultAddressUpdate(customerAccessToken: $token, addressId: $id) {
           customer { defaultAddress { id } }
           customerUserErrors { message }
         }
       }`,
      { token, id: addressId },
    );
    return userError(data?.customerDefaultAddressUpdate);
  }
};
