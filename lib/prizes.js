// Signup wheel prizes.
//
// THE SERVER PICKS. Lucira's wheel picks client-side and posts the result to
// /register, so devtools can award itself the top prize — the flashy segments are
// only unreachable because the client is polite about it. Here the client never
// chooses; it animates to whatever came back.
//
// Every `code` MUST exist as a discount code in Shopify admin, or the customer wins
// something that fails at checkout. Nothing here creates them.
//
// ponytail: a literal table, not a collection. Prizes change when marketing decides,
// which is a deploy, not a CRUD screen. Move it to Mongo the day someone who can't
// deploy needs to edit it.
// EVERY SEGMENT IS WINNABLE. The wheel previously displayed ₹5,000, ₹2,000 and Free Delivery at
// weight 0 — shown but impossible — while the copy honestly said "up to ₹750". A wheel that
// advertises ₹5,000 next to a promise of ₹750 is not a rounding error, it is the customer catching
// you out before they have even signed up, and in India an unwinnable displayed prize is the kind of
// claim that attracts consumer-protection complaints.
//
// So the ceiling on the wheel IS the ceiling in the copy: six real prizes, ₹250 to ₹750, no blanks.
// "Every spin wins" and "up to ₹750 off" are now both literally true.
//
// PLACEHOLDER AMOUNTS — confirm with the business, and create each `code` as a Shopify discount code
// before launch or a winner gets an invalid code at checkout.
const PRIZES = [
  { id: 'off_250', label: '₹250 OFF', code: 'MATERIAL250', weight: 30 },
  { id: 'off_300', label: '₹300 OFF', code: 'MATERIAL300', weight: 25 },
  { id: 'off_400', label: '₹400 OFF', code: 'MATERIAL400', weight: 20 },
  { id: 'off_500', label: '₹500 OFF', code: 'MATERIAL500', weight: 15 },
  { id: 'off_600', label: '₹600 OFF', code: 'MATERIAL600', weight: 7 },
  { id: 'off_750', label: '₹750 OFF', code: 'MATERIAL750', weight: 3 },
];

const TOTAL_WEIGHT = PRIZES.reduce((sum, p) => sum + p.weight, 0);

// Weighted pick over the winnable prizes. Uses crypto rather than Math.random: this
// hands out money, and a predictable sequence is worth predicting.
function pick(random = () => require('crypto').randomInt(0, TOTAL_WEIGHT)) {
  if (TOTAL_WEIGHT <= 0) return null;
  let roll = random();
  for (const prize of PRIZES) {
    if (prize.weight <= 0) continue;
    roll -= prize.weight;
    if (roll < 0) return prize;
  }
  return PRIZES.find((p) => p.weight > 0) || null;
}

// What the wheel renders — every segment, in order, with no weights leaked. Sending
// the odds to the browser invites a screenshot of "you had a 0% chance".
const segments = () => PRIZES.map(({ id, label }) => ({ id, label }));

module.exports = { PRIZES, TOTAL_WEIGHT, pick, segments };
