// Creates (or updates) the buying guides in Shopify's blog. Content lives in Shopify admin so it
// can be edited without a deploy; the storefront renders it at /blog/<handle> and puts the four
// newest on the homepage.
//
//   node scripts/seed-guides.js                    # dry run — shows what would change
//   node scripts/seed-guides.js --apply            # create/update, left UNPUBLISHED for review
//   node scripts/seed-guides.js --apply --publish
//
// Same shape as seed-policy-pages.js, and for the same reasons — read that file's notes first.
// The one difference: guides carry no [TO CONFIRM] placeholders, so they are safe to publish as
// written. What they DO carry is placeholder photography (see IMAGES below).
require('dotenv').config({ quiet: true });

const { adminGraphql } = require('../lib/shopify');

const BLOG_HANDLE = 'news'; // must match BLOG_HANDLE in material-frontend/src/lib/blog.js

// PLACEHOLDER IMAGERY. These are the three category photos already on the CDN — the only Material
// photography that exists. Every tile guide therefore shows the same tile photo, which is honest
// but dull. Replace each article's image in Shopify admin as real photography arrives; the seeder
// only sets an image when creating, so a replacement survives a re-run.
const CDN = 'https://cdn.shopify.com/s/files/1/0778/7636/3401/files';
const IMAGES = {
  tiles: `${CDN}/tiles.png?v=1786039457`,
  laminates: `${CDN}/Laminates.png?v=1786039520`,
  wallpaper: `${CDN}/wallpaper.png?v=1786039458`,
};

/**
 * Six guides, each one a question a customer actually asks before buying — how much to order, which
 * body, which size, which grip, which finish, and whether wallpaper survives a Mumbai monsoon.
 *
 * VOICE (§18): what the material does, not how we feel about it. Numbers where numbers exist,
 * standards named so the reader can check us, and the answer given in the first paragraph rather
 * than withheld to the end.
 *
 * Markup is styled by ELEMENT through `policy-prose` on the frontend — h2, h3, ul, ol, table,
 * strong, em, a. There are no classes to hook, so do not write any.
 */
const GUIDES = [
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'how-much-tile-to-order',
    title: 'How much tile to order',
    image: 'tiles',
    summary:
      'Floor area plus a wastage allowance, rounded up to whole boxes. Why 10% is the working number, when it should be 15%, and why ordering exactly enough is the most expensive mistake in the job.',
    body: `
<p><em>Measure the area, add a wastage allowance, then round up to whole boxes — tile is sold by the box, not the piece.</em></p>

<h2>The arithmetic</h2>
<ol>
  <li><strong>Measure each area separately</strong> — length × width, in feet or metres, one figure per room or wall. Add them together.</li>
  <li><strong>Add wastage.</strong> 10% for a plain straight lay; 15% if the tile runs diagonally, in a herringbone, or into a room with lots of corners and cut-outs.</li>
  <li><strong>Divide by the box coverage</strong> printed on every product page, then <strong>round up</strong>. Four and a bit boxes means five boxes.</li>
</ol>
<p>A 12 ft × 10 ft bedroom is 120 sq ft. With 10% wastage that is 132 sq ft. At 15.5 sq ft a box, that is 8.5 boxes — so nine.</p>

<h2>What the wastage is actually for</h2>
<p>It is not padding. It covers four real things:</p>
<ul>
  <li><strong>Cuts.</strong> Every tile that meets a wall, a door frame or a drain is cut, and the offcut is usually unusable.</li>
  <li><strong>Pattern setting-out.</strong> A layout centred on the room wastes more at the edges than one started from a corner — and it looks considerably better.</li>
  <li><strong>Transit breakage.</strong> Tile travels on pallets by road. A small amount arrives broken; that is why our <a href="/pages/returns">returns policy</a> treats up to 2% of an order, or one box, as normal.</li>
  <li><strong>The spare box.</strong> Keep it. A cracked tile two years from now is a ten-minute repair if you have a match and a re-floored room if you don't.</li>
</ul>

<h2>Why you cannot just order more later</h2>
<p><strong>Tile is made in batches, and batches differ.</strong> Two boxes of the same product from different production runs can vary slightly in shade and in size — enough to see once they are laid side by side under one light. The industry prints a batch or shade code on the box for exactly this reason.</p>
<p>Order the whole job in one go, and it comes from one batch. Order 90% now and the rest in three weeks, and the last row of your floor may not match the first.</p>

<h2>Order a sample before you order the floor</h2>
<p>A screen cannot tell you what a tile looks like under your own light, and no two rooms light the same. A sample settles it, and we refund the cost against your order when you buy the material.</p>

<h2>If you would rather not do the sums</h2>
<p>Send us the room dimensions on <a href="/pages/contact">WhatsApp</a> with the tile you are looking at, and we will come back with a box count and a price. It takes us a few minutes and it is the cheapest part of the job to get right.</p>
`,
  },
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'choosing-laminate-finishes',
    title: 'Choosing a laminate: thickness, finish, and where each belongs',
    image: 'laminates',
    summary:
      'Thickness decides what the sheet can take; finish decides what it looks like after a year of fingerprints. What 0.8 mm and 1 mm are each for, and why high gloss is a harder finish to live with than it looks.',
    body: `
<p><em>Use 1 mm on anything you touch, open or put weight on. Use 0.8 mm on the sides and interiors nobody sees. Pick the finish for how the surface will be used, not for how it photographs.</em></p>

<h2>Thickness</h2>
<ul>
  <li><strong>0.8 mm</strong> — the standard for shutter interiors, wardrobe backs, cabinet sides and any surface that is seen but not handled. Cheaper, and lighter on a large run of carcass work.</li>
  <li><strong>1 mm</strong> — the working thickness. Kitchen shutters, wardrobe fronts, tabletops, anything with a handle on it or a bag put down on it.</li>
  <li><strong>1.25 mm and above</strong> — counters, reception desks, shop fittings, and horizontal surfaces that take a beating.</li>
</ul>
<p>Sheets are made to a standard 8 ft × 4 ft, which is what your carpenter plans around. Compact laminate, at 6–12 mm, is a different product entirely: it needs no substrate and is used for locker doors, bathroom cubicles and outdoor work.</p>

<h2>Finish, and how each one ages</h2>
<ul>
  <li><strong>Matt (suede).</strong> The most forgiving surface there is. Hides fingerprints, hides light scratching, and does not throw glare across a kitchen. The default for shutters for good reason.</li>
  <li><strong>High gloss.</strong> Reflective, deep, and unforgiving — it shows every fingerprint and every wipe mark, and fine scratches catch the light permanently. Beautiful on a low-traffic feature; punishing on a family kitchen.</li>
  <li><strong>Textured and synchronised.</strong> The texture follows the printed grain, so a woodgrain feels like wood under the hand. The closest a laminate gets to veneer, and the most convincing of the wood looks.</li>
  <li><strong>Anti-fingerprint matt.</strong> A recent surface class worth the premium on dark colours, where ordinary matt still shows marks.</li>
</ul>

<h2>Dark colours cost more to live with</h2>
<p>A dark gloss shutter shows dust, water spots and fingerprints that the same design in matt would hide. The colour is a decision about cleaning as much as about the room, and it is worth handling a sample with your own hands before committing a whole kitchen to it.</p>

<h2>What to check on the sample</h2>
<ul>
  <li>Look at it <strong>vertically, in the room's own light</strong>. A sheet flat on a table under a showroom light tells you very little.</li>
  <li>Press a thumb on it and look at what stays behind.</li>
  <li>Check the <strong>edge banding</strong> match — an unmatched edge is what makes good laminate work look cheap.</li>
  <li>Check the sheets are from <strong>one batch</strong>. As with tile, print runs vary, and two shutters side by side is where you will see it.</li>
</ul>
`,
  },
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'wallpaper-in-mumbai',
    title: 'Wallpaper in a Mumbai flat: what survives the monsoon',
    image: 'wallpaper',
    summary:
      'Wallpaper works here, on the right wall. How to tell whether your wall is dry enough, which material to choose for humidity, and where paint or panelling is the better answer.',
    body: `
<p><em>Wallpaper lasts in this city on internal, dry walls. On an external wall that goes damp in July, no wallpaper and no adhesive will save it — the wall has to be fixed first.</em></p>

<h2>Test the wall before you choose the paper</h2>
<p>Damp is the only thing that reliably kills wallpaper here. Before ordering, check the wall you mean to cover:</p>
<ul>
  <li><strong>Is it external?</strong> The walls that face the rain are the walls that hold water. An internal partition is a far safer bet.</li>
  <li><strong>Any history of patches, blistering paint or a musty smell?</strong> That is moisture coming through, and paper over it traps it.</li>
  <li><strong>Tape test.</strong> Tape a square of plastic sheet tightly to the wall and leave it a day or two. Condensation underneath means the wall is releasing moisture.</li>
</ul>
<p>Fix the source, let the wall dry properly, then paper it. A feature wall in the living room usually passes this test; a bedroom wall backing onto an open balcony often does not.</p>

<h2>Which material</h2>
<ul>
  <li><strong>Non-woven.</strong> Breathable, dimensionally stable, and hung by pasting the wall rather than the paper — which makes it far easier to fit and to strip later. The sensible default.</li>
  <li><strong>Vinyl / vinyl-coated.</strong> A wipeable plastic face. Handles splashes and scrubbing, so it suits a passage, a child's room or the drier part of a kitchen wall. Less breathable, so it wants a wall that is genuinely dry.</li>
  <li><strong>Paper and textile.</strong> The best surfaces to look at and the least tolerant of humidity. Keep them to dry, air-conditioned rooms.</li>
  <li><strong>Self-adhesive.</strong> Convenient for a small area or a rented flat. It gives up sooner in heat and humidity — treat it as a two-to-three-year surface, not a decade.</li>
</ul>

<h2>How much to order</h2>
<p>A European roll is typically 0.53 m × 10 m, about 5.3 sq m before waste; wider Asian rolls run around 1.06 m. <strong>Pattern repeat drives the waste</strong>: a plain texture wastes very little, a large repeat can waste 15–20%, because every drop has to start at the right point in the pattern.</p>
<p>Measure the wall's width, divide by the roll width to get the number of drops, then work out how many drops come out of one roll at your wall height — and round up. Order the whole wall in <strong>one batch number</strong>, for the same reason tile comes from one batch.</p>

<h2>When to use something else</h2>
<ul>
  <li><strong>Bathrooms and the wall behind a hob</strong> — tile. Wallpaper is not for standing water or cooking grease.</li>
  <li><strong>A wall that gets knocked, scuffed and cleaned constantly</strong> — paint, which you can touch up in five minutes.</li>
  <li><strong>A feature wall you want to feel substantial</strong> — fluted or louvred panelling reads with more depth than any print of it.</li>
</ul>
<p>Wallpaper earns its place where you want a pattern, a texture or a mural that paint cannot give you, on a wall that stays dry. That is a real and common case — just not every wall in the flat.</p>
`,
  },
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'vitrified-or-ceramic',
    title: 'Vitrified or ceramic: which floor tile',
    image: 'tiles',
    summary:
      'The difference is water absorption, and everything else follows from it. Where ceramic is the right answer, where it is a false economy, and what full-body, GVT and double-charge actually mean.',
    body: `
<p><em>Vitrified tile absorbs almost no water and is harder; ceramic absorbs more and is cheaper. For a floor that gets walked on and wet, buy vitrified. For a wall, ceramic is often the better buy.</em></p>

<h2>The one number that separates them</h2>
<p><strong>Water absorption.</strong> Vitrified tile is fired hotter with a higher silica content, until the body effectively glasses over — under 0.5% absorption, the threshold IS 15622 uses. Ceramic sits well above it, commonly 3% to 10% or more.</p>
<p>A body that takes in water is a body that stains from underneath, weakens where it is soaked, and — in a climate that cycles between soaking and drying — moves. That is the whole argument.</p>

<h2>Where each one belongs</h2>
<table>
  <tr><th>Use</th><th>Buy</th></tr>
  <tr><td>Living room, bedroom, passage floors</td><td>Vitrified</td></tr>
  <tr><td>Kitchen and bathroom floors</td><td>Vitrified, anti-skid</td></tr>
  <tr><td>Balconies, terraces, anything open to the monsoon</td><td>Vitrified, anti-skid</td></tr>
  <tr><td>Bathroom and kitchen walls</td><td>Ceramic is fine, and lighter to fix</td></tr>
  <tr><td>Shops, offices, anywhere with trolleys or heavy footfall</td><td>Full-body vitrified</td></tr>
</table>
<p>Ceramic on a wall is not a compromise. Walls are not walked on, wall tile is thinner and easier to fix, and the money saved is real.</p>

<h2>The vitrified sub-types, in plain terms</h2>
<ul>
  <li><strong>Glazed vitrified (GVT / PGVT).</strong> A vitrified body with a printed and glazed surface. This is most of what you see — it is how a tile gets a convincing marble or wood face. The pattern lives in the glaze.</li>
  <li><strong>Full-body.</strong> The colour runs all the way through, so a chip shows the same colour rather than a pale scar. Fewer patterns, more durability. Worth it where trolleys, grit or heavy traffic will be.</li>
  <li><strong>Double-charge.</strong> Two layers of pigment pressed together, giving 3–4 mm of pattern depth. A middle ground: tougher than glazed, cheaper than full-body, limited to simpler designs.</li>
</ul>

<h2>Two things people get wrong</h2>
<p><strong>Gloss is not strength.</strong> A polished finish is about light, not durability — and on a floor it shows scratches and footprints sooner than a matt one. Choose the finish for the room, and the body for the job.</p>
<p><strong>Thicker is not automatically better.</strong> Body and firing decide how a tile wears. An 8 mm vitrified tile outlasts a 10 mm ceramic one on a floor.</p>
`,
  },
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'tile-sizes-explained',
    title: 'Tile sizes, and what each one is for',
    image: 'tiles',
    summary:
      'Large formats make a room read bigger and leave fewer grout lines to clean; small formats handle slopes and awkward corners. A room-by-room guide to picking the size before the design.',
    body: `
<p><em>Bigger tiles, fewer joints — a calmer floor and less grout to clean. Smaller tiles cut in better around drains, slopes and tight corners. Most homes want both, in different rooms.</em></p>

<h2>The common sizes</h2>
<ul>
  <li><strong>300 × 300 mm</strong> — bathroom floors, utility areas, small balconies. Small enough to follow a slope to a drain without the tile rocking.</li>
  <li><strong>300 × 450 and 300 × 600 mm</strong> — the standard bathroom and kitchen wall sizes. Laid vertically they lift a low ceiling.</li>
  <li><strong>600 × 600 mm</strong> — the default living-room and bedroom floor in Indian homes. Widely stocked, easy for any fixer to lay, forgiving on a floor that is not perfectly flat.</li>
  <li><strong>600 × 1200 mm</strong> — the large format that has largely replaced 600 × 600 in new work. Roughly a third of the grout lines, and where convincing marble looks live.</li>
  <li><strong>800 × 1600 mm and larger slabs</strong> — feature walls, showrooms, and floors where you want the joints to nearly disappear. Needs a genuinely flat base and a fixer who has laid them before.</li>
</ul>

<h2>Matching size to room</h2>
<p><strong>A small room does not need a small tile.</strong> The opposite, usually: fewer lines across a floor makes a compact room read as one continuous surface rather than a grid. The limit is practical, not visual — a large tile in a small room means more cutting at the edges, so the wastage allowance goes up.</p>
<p><strong>Wet floors are the exception.</strong> A bathroom floor has to fall towards a drain, and a rigid 600 × 1200 tile cannot follow two directions of slope at once. Smaller tiles, more joints, water that goes where it should.</p>

<h2>What large format demands from the floor beneath</h2>
<p>The larger the tile, the less it forgives. A high spot under a 600 × 600 tile is invisible; under a 600 × 1200 it becomes a lipped edge you catch with a foot. Large formats need a levelled base, the right adhesive rather than a thick sand-cement bed, and back-buttering. Ask your fixer what they have laid before you commit to slabs.</p>

<h2>Nominal versus actual</h2>
<p>Sizes are nominal. A "600 × 600" tile is typically a few millimetres under, which is why grout joints exist and why tiles from different batches should not be mixed in one room. Rectified tiles — cut square after firing — allow the narrowest joints, and are the reason a large-format floor can look nearly seamless.</p>
`,
  },
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'anti-skid-tiles-explained',
    title: 'Anti-skid tiles: what R10 and R11 mean',
    image: 'tiles',
    summary:
      'The R rating is a ramp test, not marketing. Which rating belongs in a bathroom, a kitchen and a monsoon-facing balcony — and why the grippiest tile is not always the right one.',
    body: `
<p><em>R9 to R13 is a slip rating measured on a ramp under DIN 51130. For a home: R10 indoors where it gets wet, R11 anywhere the rain reaches.</em></p>

<h2>What the rating measures</h2>
<p>A tester walks an oiled tile on a ramp that tilts until they slip. The angle at which that happens sets the class:</p>
<table>
  <tr><th>Class</th><th>Ramp angle</th><th>In practice</th></tr>
  <tr><td>R9</td><td>6–10°</td><td>Dry indoor floors — bedrooms, living rooms</td></tr>
  <tr><td>R10</td><td>10–19°</td><td>Kitchens, bathrooms, entrances</td></tr>
  <tr><td>R11</td><td>19–27°</td><td>Balconies, terraces, open passages, garages</td></tr>
  <tr><td>R12–R13</td><td>27°+</td><td>Commercial kitchens, industrial floors, ramps</td></tr>
</table>
<p>There is a second standard, DIN 51097, for <strong>barefoot wet</strong> areas, graded A, B and C. A shower floor rated B or C is graded for the way it will actually be used: wet, soapy, and without shoes.</p>

<h2>What to buy, room by room</h2>
<ul>
  <li><strong>Bathroom floor</strong> — R10 minimum, and B or C if the rating is quoted. Small formats also help: more grout lines is more grip.</li>
  <li><strong>Kitchen floor</strong> — R10. Oil underfoot is a harder problem than water.</li>
  <li><strong>Balcony, terrace, open passage</strong> — R11. This is a Mumbai answer as much as a technical one: for four months a year those floors are wet with driving rain and nobody is wearing shoes.</li>
  <li><strong>Bedrooms, living rooms, dry passages</strong> — R9 is fine. Do not pay for grip you will only have to scrub.</li>
</ul>

<h2>The trade-off nobody mentions</h2>
<p><strong>Grip is texture, and texture holds dirt.</strong> An R11 floor is a rougher floor: it takes more effort to mop and it will not look glassy. That is the correct trade outdoors and the wrong one in a living room. Buy the rating the room needs and no more.</p>

<h2>What grip does not fix</h2>
<p>Anti-skid tile reduces the chance of a slip; it does not eliminate it, and it cannot compensate for water that has nowhere to drain. Get the fall towards the drain right, keep the floor free of soap film, and treat the rating as the last line of defence rather than the first.</p>
`,
  },
];

const FIND = `query find($query: String!) {
  blogs(first: 1, query: $query) { nodes { id handle articles(first: 100) { nodes { id handle isPublished } } } }
}`;

const CREATE = `mutation create($article: ArticleCreateInput!) {
  articleCreate(article: $article) { article { id handle } userErrors { message } }
}`;

const UPDATE = `mutation update($id: ID!, $article: ArticleUpdateInput!) {
  articleUpdate(id: $id, article: $article) { article { id handle } userErrors { message } }
}`;

(async () => {
  const apply = process.argv.includes('--apply');
  const publish = process.argv.includes('--publish');

  const found = await adminGraphql(FIND, { query: `handle:${BLOG_HANDLE}` });
  const blog = found?.blogs?.nodes?.find((b) => b.handle === BLOG_HANDLE);
  if (!blog) {
    console.error(`No blog with handle "${BLOG_HANDLE}". Create it in Shopify admin → Content → Blog posts.`);
    process.exit(1);
  }
  const byHandle = Object.fromEntries(blog.articles.nodes.map((a) => [a.handle, a]));

  console.log(
    `${apply ? 'WRITING' : 'DRY RUN (pass --apply)'} — guides will be ${publish ? 'PUBLISHED' : 'left UNPUBLISHED for review'}\n`,
  );

  for (const [index, guide] of GUIDES.entries()) {
    const existing = byHandle[guide.handle];
    const label = guide.handle.padEnd(28);

    if (!apply) {
      console.log(`${label}${existing ? 'would update' : 'would create'}`);
      continue;
    }

    // A guide that is already live STAYS live — re-running the seeder to add one article must not
    // quietly pull the others off the storefront. Same rule as the policy-page seeder.
    // ORDER IS EDITORIAL, and the storefront sorts by publish date -- so ARRAY ORDER decides what
    // the homepage shows, first entry first. Seeded in one run they all land on the same second and
    // the four on the homepage become whatever Shopify felt like returning.
    //
    // Staggered by a MINUTE each, not a day: the reader sees today's date on all six, which is
    // true, rather than six invented publication dates going back a week.
    const input = {
      title: guide.title,
      body: guide.body,
      summary: guide.summary,
      publishDate: new Date(Date.now() - index * 60_000).toISOString(),
      isPublished: publish || Boolean(existing?.isPublished),
    };

    // Image only on CREATE. These are placeholders; once someone replaces one in admin, a re-run
    // of the seeder must not put the stock photo back.
    const res = existing
      ? await adminGraphql(UPDATE, { id: existing.id, article: input })
      : await adminGraphql(CREATE, {
          article: {
            ...input,
            blogId: blog.id,
            handle: guide.handle,
            author: { name: 'Material' },
            image: { url: IMAGES[guide.image], altText: guide.title },
          },
        });

    const errors = res?.articleCreate?.userErrors || res?.articleUpdate?.userErrors;
    if (errors?.length) {
      console.log(`${label}FAILED: ${errors.map((e) => e.message).join('; ')}`);
      continue;
    }

    // Read it back. A mutation returning no errors is not evidence that anything was stored —
    // pageUpdate did exactly that once, and the seeder happily reported success.
    const id = existing?.id || res?.articleCreate?.article?.id;
    const check = await adminGraphql(`query verify($id: ID!) { article(id: $id) { body } }`, { id }).catch(() => null);
    const stored = (check?.article?.body || '').replace(/\s+/g, ' ');
    const phrases = (guide.body.match(/>([^<>]{40,90})</g) || []).map((m) =>
      m.slice(1, -1).replace(/\s+/g, ' ').trim(),
    );
    const probe = phrases[Math.floor(phrases.length / 2)] || '';
    const landed = !probe || stored.includes(probe);

    console.log(`${label}${existing ? 'updated' : 'created'}${landed ? '' : '  ⚠ CONTENT DID NOT LAND — re-run'}`);
  }

  console.log('\nEdit in Shopify admin → Content → Blog posts. The storefront renders these at /blog/<handle>.');
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message.slice(0, 200));
  process.exit(1);
});
