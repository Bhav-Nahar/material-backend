// Shopify still owns cart contents. This backend only ever stores which cart id
// belongs to which customer, so there is no second copy of the prices to drift out
// of sync with Shopify's — the drift Lucira's total-mismatch guard exists to catch.
const { storefrontGraphql } = require('./shopify');

const CART_FIELDS = `
  id
  totalQuantity
  checkoutUrl
  lines(first: 100) {
    nodes {
      quantity
      merchandise { ... on ProductVariant { id } }
      attributes { key value }
    }
  }
`;

async function getCart(cartId) {
  const data = await storefrontGraphql(`query cart($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`, {
    id: cartId,
  });
  return data?.cart || null; // null for an expired or unknown id
}

async function addLines(cartId, lines) {
  if (!lines.length) return getCart(cartId);
  const data = await storefrontGraphql(
    `mutation add($cartId: ID!, $lines: [CartLineInput!]!) {
       cartLinesAdd(cartId: $cartId, lines: $lines) {
         cart { ${CART_FIELDS} }
         userErrors { message }
       }
     }`,
    { cartId, lines },
  );
  const result = data?.cartLinesAdd;
  if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
  return result?.cart || null;
}

// Tells Shopify which customer owns this cart, so its hosted checkout is
// pre-filled and the resulting order is attributed to the account.
async function attachBuyer(cartId, customerAccessToken) {
  const data = await storefrontGraphql(
    `mutation buyer($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
       cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
         cart { id }
         userErrors { message }
       }
     }`,
    { cartId, buyerIdentity: { customerAccessToken } },
  );
  return !data?.cartBuyerIdentityUpdate?.userErrors?.length;
}

// Lines of `from` that `into` doesn't already have, as cartLinesAdd input. Same
// variant in both is left alone rather than summed: the customer put 3 boxes in the
// cart on their phone and 3 on their laptop because it is the same intent seen
// twice, not six boxes. Guessing high here costs them real money.
function linesToCopy(from, into) {
  const have = new Set((into?.lines?.nodes || []).map((l) => l.merchandise?.id).filter(Boolean));
  return (from?.lines?.nodes || [])
    .filter((l) => l.merchandise?.id && !have.has(l.merchandise.id))
    .map((l) => ({
      merchandiseId: l.merchandise.id,
      quantity: l.quantity,
      ...(l.attributes?.length
        ? { attributes: l.attributes.map(({ key, value }) => ({ key, value })) }
        : {}),
    }));
}

module.exports = { getCart, addLines, attachBuyer, linesToCopy, CART_FIELDS };
