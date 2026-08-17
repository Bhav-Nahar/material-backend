// Publishes (or unpublishes) Shopify pages by handle, WITHOUT touching their content — so edits made
// in the admin survive. The seeder rewrites bodies; this only flips visibility.
//
//   node scripts/publish-pages.js terms privacy            # publish these
//   node scripts/publish-pages.js --hide grievance-redressal
require('dotenv').config({ quiet: true });
const { adminGraphql } = require('../lib/shopify');

(async () => {
  const hide = process.argv.includes('--hide');
  const handles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!handles.length) {
    console.error('Give at least one page handle.');
    process.exit(1);
  }

  const all = await adminGraphql(`query { pages(first: 50) { nodes { id handle title isPublished body } } }`);
  const byHandle = Object.fromEntries(all.pages.nodes.map((p) => [p.handle, p]));

  for (const handle of handles) {
    const page = byHandle[handle];
    if (!page) { console.log(`${handle.padEnd(24)} NOT FOUND`); continue; }

    const todos = (page.body.match(/\[TO CONFIRM/g) || []).length;
    const res = await adminGraphql(
      `mutation vis($id: ID!, $page: PageUpdateInput!) {
         pageUpdate(id: $id, page: $page) { page { handle isPublished } userErrors { message } }
       }`,
      { id: page.id, page: { isPublished: !hide } },
    );
    const errs = res?.pageUpdate?.userErrors;
    const state = res?.pageUpdate?.page?.isPublished;

    console.log(
      `${handle.padEnd(24)} ${errs?.length ? 'FAILED: ' + errs.map((e) => e.message).join('; ') : state ? 'LIVE' : 'hidden'}` +
        (todos && state ? `   ⚠ ${todos} [TO CONFIRM] still visible to customers` : ''),
    );
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message.slice(0, 160)); process.exit(1); });
