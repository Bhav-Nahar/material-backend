/**
 * The campaign fields, as the server is willing to store them.
 *
 * Everything here arrives from a query string the customer clicked, which means it is attacker-
 * controlled text on its way to a Shopify customer tag and an order attribute. Two rules follow:
 * only known keys survive, and every value is trimmed to something an admin page can render.
 *
 * Commas matter more than they look: Shopify splits a TAG STRING on commas, so one comma in a
 * campaign name silently becomes two tags. `lib/customer.js` learned that already; this keeps the
 * lesson in one place.
 */
const KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'landing',
  'referrer',
  'firstSeen',
];

/**
 * Ad-platform click ids, which are opaque and LONG.
 *
 * 120 characters is the right ceiling for a campaign name -- it is a label a human
 * wrote and an admin page has to render. It is the wrong ceiling for these two:
 * a modern `fbclid` routinely runs past 120, and a truncated one is worse than a
 * missing one. It still looks like a valid click id, still builds a well-formed
 * `fbc` for the conversions API, and can never match the person who clicked -- so
 * the ad quietly loses credit for the sale and nothing anywhere reports an error.
 *
 * They are still trimmed, just at a length no real click id reaches, because this
 * is attacker-controlled text on its way to Shopify.
 */
const CLICK_IDS = new Set(['gclid', 'fbclid']);
const MAX_CLICK_ID = 512;

const clean = (value, key) =>
  String(value == null ? '' : value)
    .replace(/[,\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLICK_IDS.has(key) ? MAX_CLICK_ID : 120);

/** @returns {Record<string,string>} only the known keys, only the non-empty ones. */
function sanitise(utms) {
  if (!utms || typeof utms !== 'object') return {};
  const out = {};
  for (const key of KEYS) {
    const value = clean(utms[key], key);
    if (value) out[key] = value;
  }
  return out;
}

/** Shopify order/draft customAttributes. Same names the marketer already knows from the URL. */
const asOrderAttributes = (utms) =>
  Object.entries(sanitise(utms)).map(([key, value]) => ({ key, value }));

/**
 * Customer tags. Only the three fields anyone segments on -- a tag list is a filter UI, not a data
 * warehouse, and `landing`/`referrer` would make it unreadable without answering a question.
 */
const asCustomerTags = (utms) => {
  const clean_ = sanitise(utms);
  return [
    clean_.utm_source ? `utm-source:${clean_.utm_source}` : null,
    clean_.utm_medium ? `utm-medium:${clean_.utm_medium}` : null,
    clean_.utm_campaign ? `utm-campaign:${clean_.utm_campaign}` : null,
  ].filter(Boolean);
};

module.exports = { sanitise, asOrderAttributes, asCustomerTags, KEYS };
