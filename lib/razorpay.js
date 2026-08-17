const crypto = require('crypto');
const { fetchWithRetry } = require('./helpers');

/**
 * Razorpay, over plain fetch. No SDK.
 *
 * The whole surface we need is two REST calls and one HMAC — the `razorpay` package is a dependency,
 * a version to track and a wrapper around exactly this. The recovered GlassQuick routes do the same.
 *
 * Amounts are in PAISE everywhere in this file. Razorpay rejects a fractional amount, and a rupee
 * float that has been through JSON is exactly how you end up owing someone ₹0.01.
 */
const API = 'https://api.razorpay.com/v1';

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

const configured = () => Boolean(keyId() && keySecret());

const authHeader = () =>
  'Basic ' + Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

async function createOrder({ amountPaise, receipt, notes = {} }) {
  if (!configured()) throw new Error('Razorpay is not configured');
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    // Razorpay's own floor is ₹1. Anything below is a bug upstream, not a customer action.
    throw new Error(`Invalid amount: ${amountPaise} paise`);
  }

  const res = await fetchWithRetry(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.description || `Razorpay ${res.status}`);
  return body;
}

/**
 * The signature Razorpay returns with a successful payment is HMAC-SHA256 of "orderId|paymentId"
 * under the key secret. This is the ONLY thing that proves the browser is not lying about having
 * paid — the handler runs in the customer's browser and every value in it is attacker-controlled.
 *
 * timingSafeEqual, not ===. The recovered GlassQuick route compares with ===, which leaks the
 * signature a byte at a time to anyone patient enough to measure.
 */
function verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!configured() || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return false;

  const expected = crypto
    .createHmac('sha256', keySecret())
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(razorpaySignature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Asked of Razorpay directly rather than trusted from the browser: confirms the payment exists, is
// captured, and is for the amount we expected. Belt and braces alongside the signature.
async function fetchPayment(paymentId) {
  if (!configured()) throw new Error('Razorpay is not configured');
  const res = await fetchWithRetry(`${API}/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.description || `Razorpay ${res.status}`);
  return body;
}

module.exports = { createOrder, verifySignature, fetchPayment, toPaise, configured, keyId };
