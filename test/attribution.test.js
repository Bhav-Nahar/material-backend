// Attribution values come off a query string the customer clicked and end up on a Shopify tag and
// an order attribute. This file is the trust boundary.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sanitise, asOrderAttributes, asCustomerTags } = require('../lib/attribution');

test('keeps the known keys and drops everything else', () => {
  const out = sanitise({
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'tiles-mumbai',
    gclid: 'abc123',
    tags: 'vip',
    id: 'gid://shopify/Customer/1',
  });
  assert.deepEqual(out, {
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'tiles-mumbai',
    gclid: 'abc123',
  });
});

test('a comma cannot split one tag into two', () => {
  // Shopify splits a tag string on commas, so this is the whole reason values are scrubbed.
  const tags = asCustomerTags({ utm_campaign: 'monsoon, sale, vip' });
  assert.deepEqual(tags, ['utm-campaign:monsoon sale vip']);
  assert.equal(tags.join(', ').split(', ').length, 1);
});

test('newlines and runs of whitespace collapse', () => {
  assert.deepEqual(sanitise({ utm_source: ' goo\ngle \t news ' }), { utm_source: 'goo gle news' });
});

test('a very long value is capped', () => {
  const { utm_campaign } = sanitise({ utm_campaign: 'x'.repeat(500) });
  assert.equal(utm_campaign.length, 120);
});

test('empty, missing and junk input are all just nothing', () => {
  assert.deepEqual(sanitise(null), {});
  assert.deepEqual(sanitise('utm_source=google'), {});
  assert.deepEqual(sanitise({ utm_source: '   ' }), {});
  assert.deepEqual(asOrderAttributes(undefined), []);
  assert.deepEqual(asCustomerTags({}), []);
});

test('order attributes carry the field names a marketer already knows', () => {
  assert.deepEqual(asOrderAttributes({ utm_source: 'meta', landing: '/collections/tiles' }), [
    { key: 'utm_source', value: 'meta' },
    { key: 'landing', value: '/collections/tiles' },
  ]);
});

test('customer tags stay to the three fields worth segmenting on', () => {
  const tags = asCustomerTags({
    utm_source: 'meta',
    utm_medium: 'paid-social',
    utm_campaign: 'launch',
    landing: '/',
    referrer: 'https://www.instagram.com/',
  });
  assert.deepEqual(tags, ['utm-source:meta', 'utm-medium:paid-social', 'utm-campaign:launch']);
});

test('a long click id survives, while a long campaign name is still trimmed', () => {
  // A real fbclid of this era. Truncated at 120 it stays well-formed and becomes
  // permanently unmatchable, which is the failure this guards.
  const fbclid = 'IwZXh0bgNhZW0BMABhZGlkAasqR3Vsc0IBHtOx' + 'a'.repeat(140);
  const out = sanitise({ fbclid, gclid: 'g'.repeat(300), utm_campaign: 'c'.repeat(300) });

  assert.equal(out.fbclid, fbclid, 'fbclid must survive intact');
  assert.equal(out.gclid.length, 300);
  assert.equal(out.utm_campaign.length, 120, 'campaign names are still capped at 120');
});
