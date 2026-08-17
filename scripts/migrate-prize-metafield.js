// Moves signup prizes from the old `custom.signup_prize` ("off_300|MATERIAL300") to the current
// `custom.coupon_code` (["MATERIAL300"]), and clears the old field.
//
//   node scripts/migrate-prize-metafield.js          # dry run
//   node scripts/migrate-prize-metafield.js --apply
//
// Anyone who signed up before the rename is invisible in the pinned admin field otherwise — their
// prize is still recorded, just under a key nothing reads any more.
require('dotenv').config({ quiet: true });

const { adminGraphql } = require('../lib/shopify');

const FIND = `
  query {
    customers(first: 100) {
      nodes {
        id displayName
        old: metafield(namespace: "custom", key: "signup_prize") { id value }
        current: metafield(namespace: "custom", key: "coupon_code") { value }
      }
    }
  }
`;

const SET = `
  mutation set($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key value }
      userErrors { field message }
    }
  }
`;

// metafieldsDelete (plural, taking owner+namespace+key), not metafieldDelete(input:) — the singular
// form with MetafieldDeleteInput was removed from the Admin API.
const DELETE_OLD = `
  mutation del($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key }
      userErrors { field message }
    }
  }
`;

(async () => {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'MIGRATING\n' : 'DRY RUN (pass --apply)\n');

  const data = await adminGraphql(FIND);
  const targets = data.customers.nodes.filter((c) => c.old?.value);

  if (!targets.length) {
    console.log('nothing to migrate');
    process.exit(0);
  }

  for (const customer of targets) {
    // Old format is "prizeId|CODE" — the code is the half worth keeping.
    const code = String(customer.old.value).split('|').pop().trim();
    const name = (customer.displayName || customer.id).padEnd(20);

    if (customer.current?.value) {
      console.log(`${name} already has coupon_code = ${customer.current.value}, skipping`);
      continue;
    }
    if (!apply) {
      console.log(`${name} would set coupon_code = ["${code}"]`);
      continue;
    }

    const set = await adminGraphql(SET, {
      metafields: [
        {
          ownerId: customer.id,
          namespace: 'custom',
          key: 'coupon_code',
          type: 'list.single_line_text_field',
          value: JSON.stringify([code]),
        },
      ],
    });
    const setErrors = set.metafieldsSet.userErrors;
    if (setErrors.length) {
      console.log(`${name} FAILED: ${setErrors.map((e) => e.message).join('; ')}`);
      continue;
    }

    // Only after the new value is safely written.
    await adminGraphql(DELETE_OLD, {
      metafields: [{ ownerId: customer.id, namespace: 'custom', key: 'signup_prize' }],
    });
    console.log(`${name} coupon_code = ["${code}"]  (old field removed)`);
  }

  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message.slice(0, 200));
  process.exit(1);
});
