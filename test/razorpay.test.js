// The signature check is the only thing standing between "the browser says it paid" and a real
// order, so it gets tested on both sides: a genuine signature must pass, and every near-miss must
// fail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_value';

const razorpay = require('../lib/razorpay');

const sign = (orderId, paymentId, secret = process.env.RAZORPAY_KEY_SECRET) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

test('a genuine signature verifies', () => {
  const razorpayOrderId = 'order_ABC123';
  const razorpayPaymentId = 'pay_XYZ789';
  assert.equal(
    razorpay.verifySignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
    }),
    true,
  );
});

test('every near-miss fails', () => {
  const order = 'order_ABC123';
  const pay = 'pay_XYZ789';
  const good = sign(order, pay);

  const cases = [
    ['wrong secret', { razorpayOrderId: order, razorpayPaymentId: pay, razorpaySignature: sign(order, pay, 'other') }],
    ['swapped order id', { razorpayOrderId: 'order_OTHER', razorpayPaymentId: pay, razorpaySignature: good }],
    ['swapped payment id', { razorpayOrderId: order, razorpayPaymentId: 'pay_OTHER', razorpaySignature: good }],
    ['truncated signature', { razorpayOrderId: order, razorpayPaymentId: pay, razorpaySignature: good.slice(0, -2) }],
    ['empty signature', { razorpayOrderId: order, razorpayPaymentId: pay, razorpaySignature: '' }],
    ['missing payment id', { razorpayOrderId: order, razorpayPaymentId: '', razorpaySignature: good }],
    ['reversed pair', { razorpayOrderId: pay, razorpayPaymentId: order, razorpaySignature: good }],
  ];

  for (const [label, input] of cases) {
    assert.equal(razorpay.verifySignature(input), false, `${label} must not verify`);
  }
});

test('rupees convert to paise without float drift', () => {
  // 1844.5 * 100 in floating point is 184449.99999999997 — truncating that bills a rupee short.
  assert.equal(razorpay.toPaise(1844.5), 184450);
  assert.equal(razorpay.toPaise(7378), 737800);
  assert.equal(razorpay.toPaise(0.1 + 0.2), 30);
});

test('an amount below Razorpay’s ₹1 floor is refused', async () => {
  await assert.rejects(
    () => razorpay.createOrder({ amountPaise: 50, receipt: 'r' }),
    /Invalid amount/,
  );
});
