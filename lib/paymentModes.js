/**
 * How much of an order Razorpay collects today.
 *
 * THE ONLY PLACE THE SERVER COMPUTES AN ADVANCE. The browser sends a mode ('full' | 'ppcod') and
 * never an amount — a client that could name its own advance could pay ₹1 against ₹50,000.
 *
 * The frontend keeps a mirror of this in src/lib/payment-modes.js so it can quote a number on a
 * button before the customer commits. That copy is cosmetic; this one is the charge. Change both.
 *
 * 20% is the house rule, taken from the Lucira build's partial-COD (total * 0.2). Its OTHER rule --
 * only for orders under ₹50,000 -- is deliberately NOT copied: that is a jewellery risk cap, and on
 * a store where one room of tile clears ₹50,000 it would switch the option off for exactly the
 * orders that need it.
 *
 * ponytail: confirm the percentage and any cap with operations before launch.
 */
const ADVANCE_PERCENT = 20;
const PAYMENT_MODES = ['full', 'ppcod'];

// Rounded to the rupee, so the customer is charged what they were quoted rather than a number with
// paise Razorpay would then show them.
const advanceFor = (total) => Math.max(1, Math.round((Number(total) * ADVANCE_PERCENT) / 100));

// What the driver collects. Kept here rather than inlined so the two halves cannot drift into
// summing to something other than the order total.
const balanceFor = (total) => Math.max(0, Math.round((Number(total) - advanceFor(total)) * 100) / 100);

module.exports = { ADVANCE_PERCENT, PAYMENT_MODES, advanceFor, balanceFor };
