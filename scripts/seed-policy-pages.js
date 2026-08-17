// Creates (or updates) the policy pages in Shopify. Content lives in Shopify admin so anyone can
// edit it without a deploy; the storefront renders it at /pages/<handle>.
//
//   node scripts/seed-policy-pages.js            # dry run — shows what would change
//   node scripts/seed-policy-pages.js --apply    # create/update, left UNPUBLISHED for review
//   node scripts/seed-policy-pages.js --apply --publish
//
// Pages are created UNPUBLISHED on purpose: several carry [TO CONFIRM] placeholders that only the
// business can fill (legal entity, GSTIN, grievance officer). Publishing a policy page with a
// placeholder in it is worse than not having the page.
require('dotenv').config({ quiet: true });

const { adminGraphql } = require('../lib/shopify');

const TODO = (what) => `<mark>[TO CONFIRM: ${what}]</mark>`;

const PAGES = [
  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'returns',
    title: 'Returns and breakage',
    body: `
<p><em>How we handle material that arrives broken, faulty or wrong — and what we can't take back.</em></p>

<h2>If it arrives damaged</h2>
<p>Tile and stone travel by road on pallets. A small amount of transit breakage is normal in this trade, and we price for it — but it is our job to get your order to you in usable condition, not yours to absorb.</p>
<ul>
  <li><strong>Up to 2% of an order, or one box — whichever is greater — is treated as normal transit breakage.</strong> This is why we ask you to order a wastage allowance, and it is the reason for the industry standard of 1–2% on palletised ceramic.</li>
  <li><strong>Above that, we replace the broken material free.</strong> No deduction, no restocking fee, no freight charge to you.</li>
  <li>The one-box floor matters on small orders: on a five-box order, one broken box is covered.</li>
</ul>

<h2>Send us the unboxing video</h2>
<p>We replace on the strength of <strong>one continuous, unedited video</strong> of the material being opened. A photograph can show that a tile is broken; it cannot show when it broke, and that is the question a claim turns on.</p>
<ul>
  <li>Start filming with the <strong>pallet or cartons still sealed</strong>, then open them on camera and show the damaged pieces.</li>
  <li>One take. No cuts, no edits, no stills.</li>
  <li>You do not need to film every box in a large order — the sealed packaging, the opening, and the damage is enough.</li>
  <li>Send it within <strong>48 hours of delivery</strong>, by WhatsApp or email, with your order number.</li>
</ul>
<p>We tell you this when your order is dispatched, so you know to film before you open anything. <strong>If you didn't film it, tell us anyway.</strong> A video means we approve the replacement immediately; without one we'll still look at your claim, it just takes a conversation.</p>

<h2>If it's faulty, not broken</h2>
<p>A manufacturing defect — warping, glaze faults, a batch that doesn't match its own sample — is a different thing from transit damage, and <strong>no percentage applies</strong>. If the material is defective we replace it, however much of the order is affected.</p>

<h2>If we sent the wrong thing</h2>
<p>Tell us within 48 hours. We collect the wrong material at our cost and deliver the right material as a priority. You pay nothing.</p>

<h2>If you've changed your mind</h2>
<p>We can't take material back because a decision changed. Boxes are picked and mixed to your order, slabs and panels are cut to size, and the freight on returning a pallet is a significant cost on its own.</p>
<p><strong>Order a sample first.</strong> We refund the cost of samples against your order when you buy the material. A ₹99 sample under your own lighting settles a question that a photograph on a screen cannot.</p>

<h2>Return freight</h2>
<p>Where a return is agreed and the fault is not ours, <strong>you arrange and pay the return freight</strong>, and the material has to reach us in its original packing. Where the fault <em>is</em> ours — damage, a defect, or the wrong item — we collect at our cost.</p>

<h2>Replacements and refunds</h2>
<ul>
  <li>We replace with the same material wherever we can. Tile is made in batches, so we will tell you if a replacement comes from a different batch and let you decide.</li>
  <li>If we can't replace it, we'll agree an alternative with you or refund that part of the order.</li>
  <li>Refunds go back to the original payment method within <strong>5–7 working days</strong>.</li>
</ul>

<h2>Making a claim</h2>
<p>WhatsApp or email us with your <strong>order number</strong>, the <strong>video</strong>, and a line about what's wrong. ${TODO('support WhatsApp number and email')}</p>
<p>We acknowledge every claim within 48 hours and resolve it within 30 days, in line with the Consumer Protection (E-Commerce) Rules, 2020. If you're unhappy with the outcome, our grievance officer is listed on the <a href="/pages/grievance-redressal">grievance redressal</a> page.</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'delivery',
    title: 'Shipping and delivery',
    body: `
<p><em>Where we deliver, what it costs, and how the material actually gets into your home.</em></p>

<h2>Where we deliver</h2>
<p>Mumbai and the wider MMR — Mumbai city and suburbs, Thane, Navi Mumbai, Panvel, Kalyan, Dombivli, Vasai, Virar and the surrounding areas. Enter your PIN code on any product page and we'll tell you straight away whether you're inside our area.</p>
<p>If you're just outside it, we'll often still deliver — call us and we'll quote it.</p>

<h2>What delivery costs</h2>
<p>Freight is quoted <strong>before you pay</strong>, on the checkout page, not after your order is placed. It is worked out from the weight of your order, your PIN code, and how the material has to be carried in.</p>

<h3>Two ways to receive it</h3>
<ul>
  <li><strong>Ground floor</strong> — we unload at the building entrance and you arrange the carry up. Free.</li>
  <li><strong>Doorstep</strong> — our crew carries it into your home or site. Priced on the weight, the floor, and whether there's a working lift.</li>
</ul>
<p>That is why we ask for your floor and whether there's a lift when you save an address. Nine hundred kilos of tile carried to a fourth floor without a lift is a different job from the same order wheeled into a ground-floor entrance, and we would rather quote it honestly up front than argue about it at your door.</p>

<h2>Timelines</h2>
<p>${TODO('dispatch and delivery timelines — e.g. dispatched in X working days, delivered in Y')}</p>
<p>We call you before delivery to agree a slot. Someone needs to be there to receive the material and check it — see <a href="/pages/returns">returns and breakage</a> for what to do if something arrives damaged.</p>

<h2>Before the truck arrives</h2>
<ul>
  <li><strong>Check the address and the floor.</strong> We can't be responsible for a failed delivery to an address that was entered incorrectly, and a wasted trip on a loaded truck is expensive to repeat.</li>
  <li><strong>Tell us about access.</strong> Narrow lanes, height restrictions, gated societies with delivery hours, no lift — anything that affects how a pallet reaches you.</li>
  <li><strong>Have somewhere to put it.</strong> Materials are heavy and we can't leave a pallet in a corridor or a shared lobby.</li>
</ul>

<h2>Installation</h2>
<p>We supply materials; we don't install them. ${TODO('whether we recommend fitters, and how')}</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'cancellation',
    title: 'Cancelling an order',
    body: `
<p><em>What you can cancel, when, and how the money comes back.</em></p>

<h2>Within 24 hours</h2>
<p>Contact us within <strong>24 hours of placing your order</strong> and we'll cancel it and refund you in full. No cancellation fee.</p>
<p>${TODO('support WhatsApp number and email')} — quote your order number.</p>
<p>If your order has already been dispatched inside that window, we can't recall the truck — so the sooner you tell us, the better.</p>

<h2>After 24 hours</h2>
<p>By then your order is being picked, and heavy material that has been pulled, mixed and loaded can't simply go back on the shelf. Contact us anyway: if it hasn't left our warehouse we'll usually still cancel it.</p>
<p>If it has been delivered and the material arrived damaged or faulty, or we sent the wrong thing, <a href="/pages/returns">returns and breakage</a> covers it. If you've simply changed your mind, we're not able to take heavy materials back — which is why we'd rather you ordered a sample first.</p>

<h2>Cancelling part of an order</h2>
<p>Same 24-hour window. Tell us which lines you want removed and we'll refund those and adjust the freight.</p>

<h2>If we cancel</h2>
<p>Occasionally we have to — stock that turns out to be damaged, a pricing error, or a payment we can't verify. We'll call you, explain, and refund the full amount immediately. You'll never be left holding a paid order we can't fulfil.</p>

<h2>Refunds</h2>
<p>Refunds go back to the original payment method within <strong>5–7 working days</strong>. UPI and card refunds usually land sooner than that; your bank sets the final timing, not us.</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'grievance-redressal',
    title: 'Grievance redressal',
    body: `
<p><em>If something has gone wrong and the usual channels haven't fixed it, this is who to contact and what to expect.</em></p>

<h2>Start with support</h2>
<p>Most problems are fastest to solve directly. ${TODO('support WhatsApp number, email and hours')} — have your order number ready.</p>

<h2>Grievance officer</h2>
<p>Appointed under the Consumer Protection (E-Commerce) Rules, 2020.</p>
<ul>
  <li><strong>Name</strong> — ${TODO('grievance officer name')}</li>
  <li><strong>Designation</strong> — ${TODO('designation')}</li>
  <li><strong>Email</strong> — ${TODO('grievance email')}</li>
  <li><strong>Phone</strong> — ${TODO('grievance phone')}</li>
  <li><strong>Address</strong> — ${TODO('registered office address')}</li>
</ul>

<h2>What we commit to</h2>
<ul>
  <li>We <strong>acknowledge every complaint within 48 hours</strong> of receiving it.</li>
  <li>We <strong>resolve it within 30 days</strong>, and tell you where things stand if it's going to take longer.</li>
  <li>You'll get a reference number, and a named person, not a queue.</li>
</ul>

<h2>Consumer helpline</h2>
<p>If you're still not satisfied, you can approach the National Consumer Helpline on <strong>1915</strong>, or the consumer commission with jurisdiction over your address. We'd rather you didn't have to, and we'll work with you first.</p>
`.trim(),
  },



  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Structure matters here: every question is an <h3> and its answer the <p> that follows. The
  // storefront route reads that shape to emit FAQPage structured data, which is how these answers
  // reach Google. Keep the pattern if you edit this page.
  {
    handle: 'faqs',
    title: 'Questions, answered',
    body: `
<p><em>The things people ask before ordering materials — how much to buy, what delivery costs, and what happens if something arrives broken.</em></p>

<h2>Ordering</h2>

<h3>How much should I order?</h3>
<p>Work from the area, not the number of boxes. Every product page has a calculator: enter your square footage and it works out the boxes, including wastage. As a rule of thumb, order <strong>10% extra for tiles, laminates and flooring</strong>, and <strong>15–20% extra for wallpaper</strong>, where the pattern repeat eats more.</p>

<h3>Why do I need to order extra?</h3>
<p>Cuts at edges and corners, the odd tile that breaks while being laid, and a few spares for repairs years later. Running out mid-job is the expensive outcome: the replacement will come from a different batch and it will not match.</p>

<h3>Can I order a sample first?</h3>
<p>Yes, and you should. A screen cannot show you how a material looks under your own lighting, next to your own furniture. Samples cost ₹99 and we refund that against your order when you buy the material.</p>

<h3>Is there a minimum order?</h3>
<p>No. Order one box or fifteen.</p>

<h3>Can I get a GST invoice?</h3>
<p>Yes. Tick “I need a GST invoice” at checkout and enter your GSTIN and registered business name. The invoice is emailed with your order confirmation.</p>

<h2>Delivery</h2>

<h3>Where do you deliver?</h3>
<p>Mumbai and the wider MMR — Mumbai city and suburbs, Thane, Navi Mumbai, Panvel, Kalyan, Dombivli, Vasai and Virar. Enter your PIN code on any product page to check. Just outside that area, ask us and we will usually quote it.</p>

<h3>How much does delivery cost?</h3>
<p>It depends on the weight of your order, your PIN code, and how the material has to be carried in. The figure is shown <strong>at checkout, before you pay</strong> — never quoted afterwards. See <a href="/pages/delivery">delivery and freight</a>.</p>

<h3>What is the difference between ground floor and doorstep delivery?</h3>
<p><strong>Ground floor</strong> means we unload at the building entrance and you arrange the carry up — free, and often what a contractor with a site team wants anyway. <strong>Doorstep</strong> means our crew carries it into your home, priced on the weight, the floor and whether there is a working lift.</p>

<h3>Why do you ask about my floor and whether there is a lift?</h3>
<p>Because it decides what the delivery costs. Nine hundred kilos of tile carried to a fourth floor without a lift is a different job from the same order wheeled into a ground-floor entrance, and we would rather quote it honestly at checkout than surprise you at your door.</p>

<h3>How long does delivery take?</h3>
<p>${TODO('dispatch and delivery timelines')} We call you before delivery to agree a slot.</p>

<h3>Does someone need to be there?</h3>
<p>Yes. Someone has to receive the material, check it, and sign for it — and you will want to film the unboxing before anything is opened. Materials are heavy and cannot be left in a corridor or a shared lobby.</p>

<h2>Payment</h2>

<h3>How can I pay?</h3>
<p>UPI, credit and debit cards, net banking and wallets, all through Razorpay. We never see or store your card details.</p>

<h3>When am I charged?</h3>
<p>At checkout, before the order is placed. You will see the material, GST and delivery broken out separately before you pay anything.</p>

<h2>If something goes wrong</h2>

<h3>What if my order arrives damaged?</h3>
<p>Film the unboxing in one continuous take — sealed packaging, then opening, then the damage — and send it to us within 48 hours. Breakage above <strong>2% of the order, or one box, whichever is greater</strong>, is replaced free. Full details on <a href="/pages/returns">returns and breakage</a>.</p>

<h3>Why do you need a video and not photographs?</h3>
<p>A photograph shows that a tile is broken. It cannot show when it broke, and that is the question a claim turns on. A single unedited take of the sealed box being opened settles it, which is why we can approve those claims immediately.</p>

<h3>What if I did not film it?</h3>
<p>Tell us anyway. A video means we approve the replacement on the spot; without one we will still look at your claim, it just takes a conversation.</p>

<h3>What if the material is faulty rather than broken?</h3>
<p>A manufacturing defect — warping, glaze faults, a batch that does not match its own sample — has <strong>no percentage threshold at all</strong>. We replace it however much of the order is affected.</p>

<h3>Can I return material I have changed my mind about?</h3>
<p>No. Boxes are picked and mixed to your order, slabs and panels are cut to size, and return freight on a pallet is a significant cost. This is exactly what samples are for — order one before you commit.</p>

<h3>Can I cancel my order?</h3>
<p>Yes, within <strong>24 hours</strong> of placing it, for a full refund and no fee. After that, contact us anyway — if it has not left our warehouse we can usually still cancel. See <a href="/pages/cancellation">cancelling an order</a>.</p>

<h2>About the materials</h2>

<h3>Will the tiles match the photograph exactly?</h3>
<p>Close, but not exactly. Tile, stone and wood are made and finished in batches, and shade varies between them — this is normal in the trade, not a defect. Order a sample if the precise shade matters, and order all of a job at once.</p>

<h3>Why does ordering everything at once matter?</h3>
<p>Because a top-up order weeks later will likely come from a different batch, and the difference is visible on a finished wall or floor. It is the single most common regret in this category.</p>

<h3>Anything specific to wallpaper?</h3>
<p>Order 15–20% extra rather than 10%, match the pattern repeat when calculating rolls, and buy every roll from the same batch. Wallpaper is the least forgiving material we sell for running short.</p>

<h3>Anything specific to laminates?</h3>
<p>Two things. Order a sample and look at it under your own lighting — laminate colour shifts more than any other category between a photograph and a room. And laminate <strong>both faces</strong> of any panel: decorative on the visible side, a 0.6–0.8 mm balancing liner on the hidden side, or the panel will warp over time.</p>

<h3>Anything specific to wooden flooring?</h3>
<p>Let the planks acclimatise in the room for 48–72 hours before laying. Skipping it is the usual cause of buckling later, and it looks like a product fault when it is not one.</p>

<h3>Do you install?</h3>
<p>We supply materials; we do not install them. ${TODO('whether we recommend fitters, and how')}</p>

<h2>Your account</h2>

<h3>Why do I sign in with a mobile number instead of a password?</h3>
<p>One code by SMS, no password to remember or lose. The number also gives the delivery driver a way to reach you, which matters more on a pallet delivery than on a parcel.</p>

<h3>Where do I find my coupons and orders?</h3>
<p>Under <a href="/account">your account</a> — orders with tracking, saved items, delivery addresses and any coupons you have won.</p>

<h3>How do I stop marketing messages?</h3>
<p>Reply STOP to any SMS, use the unsubscribe link in an email, or tell us. Order updates and delivery calls are not marketing and will continue.</p>

<h2>Still stuck?</h2>
<p><a href="/pages/contact">Talk to us</a> — a person in Mumbai who knows the material, not a ticket queue.</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'contact',
    title: 'Contact us',
    body: `
<p><em>A real person, in Mumbai, who knows the material. Not a ticket queue.</em></p>

<h2>Talk to us</h2>
<ul>
  <li><strong>WhatsApp</strong> — ${TODO('WhatsApp number')} · fastest for photos, site pictures and quick questions</li>
  <li><strong>Phone</strong> — ${TODO('support phone number')}</li>
  <li><strong>Email</strong> — ${TODO('support email address')}</li>
  <li><strong>Hours</strong> — ${TODO('opening hours, e.g. Mon–Sat, 10am–7pm')}</li>
</ul>
<p>Have your <strong>order number</strong> ready if your question is about an order — it's on your confirmation and under <a href="/account/orders">your orders</a>.</p>

<h2>What we can help with</h2>
<ul>
  <li><strong>Which material to use.</strong> Tell us the room, the area and roughly what you're after and we'll narrow it down. Anti-skid for a bathroom floor, a laminate that won't warp on a shutter — that's a two-minute conversation, not an afternoon of scrolling.</li>
  <li><strong>How much to order.</strong> Give us your area and we'll work out boxes and wastage with you. Getting this wrong is expensive in both directions.</li>
  <li><strong>Samples.</strong> We'll send swatches so you can see a material under your own lighting. The cost is refunded against your order.</li>
  <li><strong>Delivery outside our usual area.</strong> We deliver across Mumbai and the MMR as standard; just outside it, ask and we'll quote.</li>
  <li><strong>Access and unloading.</strong> Narrow lane, no lift, delivery-hour restrictions — tell us before the truck is loaded, not after.</li>
  <li><strong>Something went wrong.</strong> See <a href="/pages/returns">returns and breakage</a> — and send the unboxing video with your message.</li>
</ul>

<h2>When you'll hear back</h2>
<p>We reply to every message within <strong>48 hours</strong>, and usually the same working day. If your order is already on the road, call rather than email — it's quicker and the truck won't wait.</p>
<p>If something isn't resolved to your satisfaction, our grievance officer and the timelines we commit to are on the <a href="/pages/grievance-redressal">grievance redressal</a> page.</p>

<h2>Where we are</h2>
<p>${TODO('showroom or office address, and whether customers can visit')}</p>
<p>We deliver across Mumbai and the wider MMR — Mumbai city and suburbs, Thane, Navi Mumbai, Panvel, Kalyan, Dombivli, Vasai and Virar. Enter your PIN code on any product page to check.</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'terms',
    title: 'Terms and conditions',
    body: `
<p><em>The agreement between you and us when you buy from this website.</em></p>

<h2>Who you're buying from</h2>
<ul>
  <li><strong>Legal name</strong> — ${TODO('registered company name')}</li>
  <li><strong>Registered office</strong> — ${TODO('registered address')}</li>
  <li><strong>GSTIN</strong> — ${TODO('GSTIN')}</li>
  <li><strong>CIN</strong> — ${TODO('CIN')}</li>
  <li><strong>Contact</strong> — ${TODO('support email and phone')}</li>
</ul>

<h2>Your account</h2>
<p>You sign in with your mobile number and a one-time code. That number identifies your account, your orders and your delivery addresses, so keep access to it secure and tell us if it changes hands. We may refuse or close an account we believe is being used fraudulently.</p>

<h2>Prices and product information</h2>
<p>Prices are in Indian rupees and include GST unless stated otherwise. Delivery and unloading are charged separately and shown before you pay.</p>
<p>We describe materials as accurately as we can, but <strong>natural and manufactured materials vary</strong>. Tile, stone and wood differ in shade and pattern between batches; a screen cannot show that faithfully. Order a sample if the exact shade matters — we refund it against your order.</p>
<p>If a price or a specification is obviously wrong, we may cancel the order and refund you in full rather than honour an error.</p>

<h2>When an order is accepted</h2>
<p>Your payment and order confirmation do not, by themselves, form a contract — an order is accepted when we confirm it and dispatch it. If we can't fulfil it, we cancel and refund in full.</p>

<h2>Delivery, returns and cancellation</h2>
<p>Covered in full on <a href="/pages/delivery">shipping and delivery</a>, <a href="/pages/returns">returns and breakage</a> and <a href="/pages/cancellation">cancelling an order</a>. Those pages form part of these terms.</p>

<h2>What we're responsible for</h2>
<p>We're responsible for delivering the material you ordered, in the condition described, to the address you gave us. We are <strong>not</strong> responsible for installation, for how the material performs when fitted badly, or for consequential costs such as labour booked before a delivery arrived. Nothing here limits rights you have under the Consumer Protection Act, 2019.</p>

<h2>Using this website</h2>
<p>Photographs, descriptions and page designs on this site belong to us or our suppliers. You're welcome to use them to plan and share your project; you may not scrape the catalogue, resell the images, or present our material as your own listing.</p>

<h2>Governing law</h2>
<p>Indian law applies, and the courts at ${TODO('city for jurisdiction, e.g. Mumbai')} have jurisdiction.</p>

<h2>Changes</h2>
<p>We update these terms from time to time. The version on this page when you place an order is the one that applies to it.</p>
`.trim(),
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  {
    handle: 'privacy',
    title: 'Privacy policy',
    body: `
<p><em>What we hold about you, why, and how to get it removed.</em></p>

<h2>What we collect</h2>
<ul>
  <li><strong>Your mobile number</strong> — how you sign in, and how the driver reaches you.</li>
  <li><strong>Your name and email</strong> — for your invoice and order updates.</li>
  <li><strong>Delivery addresses</strong>, including the floor, property type and whether there's a lift. We ask because it decides what unloading costs; it isn't used for anything else.</li>
  <li><strong>Your orders, cart and saved items</strong>, so your basket survives moving between your phone and your laptop.</li>
  <li><strong>Your PIN code</strong>, to tell you whether we deliver to you.</li>
</ul>
<p>We do <strong>not</strong> store your card details. Payments are handled entirely by our payment provider.</p>

<h2>Why we hold it</h2>
<p>To sign you in, take an order, deliver it, invoice it, and answer you when something goes wrong. If you've opted in, we also use your contact details to tell you about offers and new arrivals.</p>

<h2>Marketing, and how to stop it</h2>
<p>When you create an account you can choose to hear from us by <strong>email, SMS and WhatsApp</strong>. It's one choice covering all three, ticked by default, and you can change your mind at any time — reply STOP to an SMS, use the unsubscribe link in any email, or tell us and we'll remove you. Order updates and delivery calls aren't marketing and will continue regardless.</p>

<h2>Who else processes your data</h2>
<p>We use a small number of providers, and only for the job named:</p>
<ul>
  <li><strong>Shopify</strong> — our store, product catalogue, customer records and order history.</li>
  <li><strong>MSG91</strong> — sends the one-time code that signs you in.</li>
  <li><strong>Razorpay</strong> — takes the payment. Card details go to them, never to us.</li>
  <li><strong>MongoDB Atlas</strong> — our own database, holding saved items, cart links and delivery access details.</li>
  <li>${TODO('hosting provider, and any analytics or WhatsApp provider once chosen')}</li>
</ul>
<p>We don't sell your data, and we don't share it with anyone for their own marketing.</p>

<h2>How long we keep it</h2>
<p>Order records are kept as long as tax and accounting law requires. Saved items and an abandoned cart are cleared after ${TODO('retention period for guest data, e.g. 180 days')} of inactivity. Ask us to delete your account and we'll remove what we aren't legally required to keep.</p>

<h2>Your rights</h2>
<p>You can ask us what we hold about you, correct it, or have it deleted. Most of it you can see and edit yourself under <a href="/account">your account</a>. For anything else, contact us — see <a href="/pages/grievance-redressal">grievance redressal</a> for the named officer and the timelines we commit to.</p>

<h2>Cookies</h2>
<p>We use cookies to keep you signed in and to remember your cart between visits. ${TODO('any analytics or advertising cookies, once decided')}</p>
`.trim(),
  },
];

const FIND = `
  query find($query: String!) {
    pages(first: 5, query: $query) { nodes { id handle title isPublished } }
  }
`;

const CREATE = `
  mutation create($page: PageCreateInput!) {
    pageCreate(page: $page) { page { id handle } userErrors { field message } }
  }
`;

const UPDATE = `
  mutation update($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
  }
`;

(async () => {
  const apply = process.argv.includes('--apply');
  const publish = process.argv.includes('--publish');

  console.log(
    `${apply ? 'WRITING' : 'DRY RUN (pass --apply)'} — pages will be ${publish ? 'PUBLISHED' : 'left UNPUBLISHED for review'}\n`,
  );

  for (const page of PAGES) {
    const todos = (page.body.match(/TO CONFIRM/g) || []).length;
    const found = await adminGraphql(FIND, { query: `handle:${page.handle}` }).catch(() => null);
    const existing = found?.pages?.nodes?.find((n) => n.handle === page.handle);
    const label = `${page.handle.padEnd(24)} ${String(todos).padStart(2)} to confirm`;

    if (!apply) {
      console.log(`${label}  ${existing ? 'would update' : 'would create'}`);
      continue;
    }

    // A page that is already live STAYS live. Without this, re-running the seeder to add one new
    // page silently pulled the other seven off the storefront -- every policy link in the footer
    // 404'd, and nothing in the output said so. New pages still default to hidden for review.
    const input = {
      title: page.title,
      body: page.body,
      isPublished: publish || Boolean(existing?.isPublished),
    };
    const res = existing
      ? await adminGraphql(UPDATE, { id: existing.id, page: input })
      : await adminGraphql(CREATE, { page: { ...input, handle: page.handle } });

    const errors = res?.pageCreate?.userErrors || res?.pageUpdate?.userErrors;
    if (errors?.length) {
      console.log(`${label}  FAILED: ${errors.map((e) => e.message).join('; ')}`);
      continue;
    }

    // READ IT BACK. A pageUpdate once returned no errors and wrote nothing, and the script happily
    // reported "updated" — so the mutation's own success is not evidence. Compare a fingerprint of
    // what we sent against what Shopify actually stored.
    const id = existing?.id || res?.pageCreate?.page?.id;
    const check = await adminGraphql(`query verify($id: ID!) { page(id: $id) { body } }`, { id }).catch(() => null);
    // Compare a distinctive PHRASE, not a prefix. Shopify normalises the markup it stores (and skips
    // the write entirely when the body is unchanged), so a leading-characters fingerprint reports
    // false failures on pages that are in fact correct.
    const stored = (check?.page?.body || '').replace(/\s+/g, ' ');
    const phrases = (page.body.match(/>([^<>]{40,90})</g) || [])
      .map((m) => m.slice(1, -1).replace(/\s+/g, ' ').trim())
      .filter((t) => !t.includes('TO CONFIRM'));
    const probe = phrases[Math.floor(phrases.length / 2)] || '';
    const landed = !probe || stored.includes(probe);

    console.log(`${label}  ${existing ? 'updated' : 'created'}${landed ? '' : '  ⚠ CONTENT DID NOT LAND — re-run'}`);
  }

  console.log(
    '\nEdit the content in Shopify admin → Content → Pages. Publish each page once its [TO CONFIRM] placeholders are filled.',
  );
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message.slice(0, 200));
  process.exit(1);
});
