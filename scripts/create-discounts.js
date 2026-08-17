// Creates the scratch-card discount codes in Shopify. Idempotent — run it again after changing an
// amount or adding a prize, and it skips what already exists.
//
//   node scripts/create-discounts.js          # show what would happen
//   node scripts/create-discounts.js --apply  # actually create them
//
// A prize with no matching Shopify code is a promise that fails at checkout, which is worse than
// offering nothing. This is the other half of lib/prizes.js.
require('dotenv').config({ quiet: true });

const { adminGraphql } = require('../lib/shopify');
const { PRIZES } = require('../lib/prizes');

// PLACEHOLDER, and the one number here that is a real business decision. ₹250 off a ₹300 order is a
// loss; ₹250 off the ~₹27,000 order these customers actually place is a rounding error that still
// reads as a win. Change it here and re-run — existing codes are updated, not duplicated.
const MINIMUM_SUBTOTAL = 5000;

const CURRENCY = 'INR';

const FIND = `
  query findDiscount($query: String!) {
    codeDiscountNodes(first: 5, query: $query) {
      nodes { id codeDiscount { ... on DiscountCodeBasic { title status codes(first: 1) { nodes { code } } } } }
    }
  }
`;

const CREATE = `
  mutation createDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const inputFor = (prize) => ({
  title: `Signup scratch card — ${prize.label}`,
  code: prize.code,
  startsAt: new Date().toISOString(),
  // No endsAt: the card is an evergreen signup incentive, not a campaign. Give it an end date and
  // somebody's saved code silently stops working months later.
  customerSelection: { all: true },
  // Once each. Without this the code leaks to a forum and gets used a thousand times.
  appliesOncePerCustomer: true,
  customerGets: {
    value: {
      discountAmount: {
        amount: Number(prize.label.replace(/[^0-9]/g, '')),
        appliesOnEachItem: false,
      },
    },
    items: { all: true },
  },
  minimumRequirement: {
    subtotal: { greaterThanOrEqualToSubtotal: MINIMUM_SUBTOTAL },
  },
});

(async () => {
  const apply = process.argv.includes('--apply');
  console.log(
    `${apply ? 'CREATING' : 'DRY RUN (pass --apply to create)'} — minimum subtotal ₹${MINIMUM_SUBTOTAL}\n`,
  );

  for (const prize of PRIZES) {
    const amount = Number(prize.label.replace(/[^0-9]/g, ''));
    const line = `${prize.code.padEnd(14)} ₹${String(amount).padEnd(5)} off`;

    let existing;
    try {
      const found = await adminGraphql(FIND, { query: `code:${prize.code}` });
      existing = found?.codeDiscountNodes?.nodes?.find((n) =>
        n.codeDiscount?.codes?.nodes?.some((c) => c.code === prize.code),
      );
    } catch (err) {
      console.log(`${line}  LOOKUP FAILED: ${err.message.slice(0, 80)}`);
      continue;
    }

    if (existing) {
      console.log(`${line}  exists (${existing.codeDiscount.status})`);
      continue;
    }
    if (!apply) {
      console.log(`${line}  would create`);
      continue;
    }

    try {
      const res = await adminGraphql(CREATE, { basicCodeDiscount: inputFor(prize) });
      const errors = res?.discountCodeBasicCreate?.userErrors;
      // Shopify's discount SEARCH is eventually consistent — a code created seconds ago is not yet
      // findable by `code:X`, so the lookup above misses it and we try to create it twice. Shopify
      // refuses (no duplicate is made), but reporting that as FAILED is a lie. Uniqueness rejection
      // IS the "already exists" answer the search could not give us.
      const duplicate = errors?.some((e) => /must be unique/i.test(e.message));
      if (duplicate) {
        console.log(`${line}  exists`);
      } else if (errors?.length) {
        console.log(`${line}  FAILED: ${errors.map((e) => e.message).join('; ')}`);
      } else {
        console.log(`${line}  created`);
      }
    } catch (err) {
      console.log(`${line}  FAILED: ${err.message.slice(0, 100)}`);
    }
  }

  console.log(`\n${CURRENCY} codes are shared, one use per customer, no expiry.`);
  process.exit(0);
})();
