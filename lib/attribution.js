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

const clean = (value) =>
  String(value == null ? '' : value)
    .replace(/[,\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/** @returns {Record<string,string>} only the known keys, only the non-empty ones. */
function sanitise(utms) {
  if (!utms || typeof utms !== 'object') return {};
  const out = {};
  for (const key of KEYS) {
    const value = clean(utms[key]);
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
