const { bearer } = require('../lib/auth');
const { adminGraphql, storefrontGraphql } = require('../lib/shopify');
const addressMeta = require('../lib/addressMeta');
const razorpay = require('../lib/razorpay');
const { PAYMENT_MODES, advanceFor, balanceFor } = require('../lib/paymentModes');
const { unloadingCharge, DELIVERY_OPTIONS } = require('../lib/deliveryCharges');
const attribution = require('../lib/attribution');

/**
 * Checkout: create a Razorpay order, then turn a verified payment into a Shopify order.
 *
 * THE AMOUNT IS NEVER TAKEN FROM THE BROWSER. It is read from the Shopify cart, which already has
 * the line prices and any applied discount code. The recovered GlassQuick route accepts `totalAmount`
 * from the request body and bills it — a customer can pay ₹1 for a ₹50,000 order. The client here
 * sends a cart id and nothing else that touches money.
 *
 * TWO WAYS TO PAY, and the difference is only how much of the total Razorpay collects today:
 *
 *   full  — the whole order. The Shopify order is created PAID.
 *   ppcod — an advance now, the balance collected on delivery. The Shopify order is created for the
 *           FULL total but left payment-pending, so the balance is visible as owed rather than
 *           quietly written off, and the advance is recorded on the order as an attribute.
 *
 * The advance percentage lives here, on the server. The browser sends a MODE, never a number: a
 * client that could name its own advance could pay ₹1 against a ₹50,000 order.
 */
const DRAFT_CREATE = `
  mutation createDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;

const CART_FOR_CHECKOUT = `
  query cart($id: ID!) @inContext(country: IN) {
    cart(id: $id) {
      id
      totalQuantity
      cost { totalAmount { amount currencyCode } subtotalAmount { amount } }
      discountCodes { code applicable }
      lines(first: 100) {
        nodes {
          # The line id is what empties this cart once the order exists.
          id
          quantity
          attributes { key value }
          # Weight prices the carry. Same per-variant figure the storefront reads, normalised the
          # same way -- see cartWeightKg below.
          merchandise {
            ... on ProductVariant { id title weight weightUnit product { title } }
          }
        }
      }
    }
  }
`;

const CART_EMPTY = `
  mutation empty($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { id totalQuantity }
      userErrors { message }
    }
  }
`;

// Shopify reports variant weight in whatever unit the merchant set. Kilograms is what the unloading
// table is priced in.
const cartWeightKg = (cart) =>
  Math.round(
    (cart?.lines?.nodes || []).reduce((sum, line) => {
      const w = Number(line.merchandise?.weight ?? 0);
      const unit = line.merchandise?.weightUnit;
      const kg =
        unit === 'GRAMS' ? w / 1000 : unit === 'POUNDS' ? w * 0.4536 : unit === 'OUNCES' ? w * 0.0283 : w;
      return sum + kg * (line.quantity ?? 0);
    }, 0) * 100,
  ) / 100;

module.exports = async function paymentRoutes(fastify) {
  fastify.addHook('preHandler', fastify.requireCustomer);

  const orders = () => fastify.mongo.db.collection('orders');

  // POST /api/payment/razorpay/order  { cartId, addressId }
  fastify.post('/razorpay/order', async (request, reply) => {
    if (!razorpay.configured()) {
      return reply.code(503).send({ error: 'Payments are not configured yet' });
    }

    const {
      cartId,
      addressId,
      billingAddressId,
      paymentMode = 'full',
      deliveryOption = 'ground',
      // Invoice details, collected on the shipping step. They decide nothing about the money, but
      // they are what the invoice is made out to, so they travel with the order rather than dying
      // in a query string.
      invoiceEmail,
      // The number the driver calls before delivery. The address has its own phone, but a site
      // delivery is often confirmed with a foreman who is not the account holder.
      contactPhone,
      gstin,
      company,
      // The campaign that earned this order. Stored with the pending record so it lands on the
      // Shopify order even though the browser is long gone by the time the draft is built.
      utms,
    } = request.body || {};
    if (!cartId) return reply.code(400).send({ error: 'cartId is required' });
    if (!addressId) return reply.code(400).send({ error: 'Choose a delivery address' });
    if (!PAYMENT_MODES.includes(paymentMode)) {
      return reply.code(400).send({ error: 'Choose how you would like to pay' });
    }
    if (!DELIVERY_OPTIONS.includes(deliveryOption)) {
      return reply.code(400).send({ error: 'Choose how the material should be unloaded' });
    }
    // A GSTIN is 15 characters. Validated here too: the browser check is a courtesy, and this one
    // is what keeps a malformed number off an invoice that cannot then be claimed.
    const cleanGstin = String(gstin || '').toUpperCase().trim();
    if (cleanGstin && !/^[0-9A-Z]{15}$/.test(cleanGstin)) {
      return reply.code(400).send({ error: 'A GSTIN is 15 characters, like 27AAAAA0000A1Z5' });
    }

    const data = await storefrontGraphql(CART_FOR_CHECKOUT, { id: cartId });
    const cart = data?.cart;
    if (!cart?.lines?.nodes?.length) {
      return reply.code(400).send({ error: 'Your cart is empty' });
    }

    // The carry, priced HERE. The shipping page showed the same number, but a charge the browser
    // reports is a charge the browser can zero -- and until this existed the customer was quoted an
    // unloading fee on one screen and billed the goods-only total on the next.
    const meta = await addressMeta.loadMany(fastify.mongo.db, request.customer.id);
    const access = meta.get(addressMeta.addressKey(addressId)) || {};
    const unloading = unloadingCharge({
      option: deliveryOption,
      weightKg: cartWeightKg(cart),
      floor: access.floor,
      liftAvailable: access.liftAvailable,
    });

    // Shopify's own total, after any discount code it has accepted, plus the carry.
    const goodsTotal = Number(cart.cost?.totalAmount?.amount ?? 0);
    const orderTotal = goodsTotal + unloading.amount;
    // What Razorpay collects TODAY. The order is always worth `orderTotal`; only this differs.
    const rupees = paymentMode === 'ppcod' ? advanceFor(orderTotal) : orderTotal;
    const amountPaise = razorpay.toPaise(rupees);
    if (razorpay.toPaise(orderTotal) < 100) {
      return reply.code(400).send({ error: 'Cart total is too low' });
    }
    if (amountPaise < 100) return reply.code(400).send({ error: 'Advance amount is too low' });

    const rzp = await razorpay.createOrder({
      amountPaise,
      // Razorpay caps receipt at 40 chars. The cart id's numeric tail is unique and short.
      receipt: `mat_${String(cartId).split('/').pop().slice(0, 30)}`,
      notes: { customerId: request.customer.id, cartId },
    });

    // Recorded BEFORE the customer pays, so a payment that arrives without a matching record is
    // visible as an anomaly rather than silently accepted.
    await orders()
      .updateOne(
        { razorpayOrderId: rzp.id },
        {
          $set: {
            razorpayOrderId: rzp.id,
            customerId: request.customer.id,
            cartId,
            addressId,
            // Null means "same as delivery". Stored rather than resolved now, because the addresses
            // are only read at completion time and one lookup is enough.
            billingAddressId: billingAddressId || null,
            paymentMode,
            deliveryOption,
            // Priced now, billed now, and read again at completion so the order carries the same
            // figure the customer paid rather than a re-quote against an address edited since.
            unloading: { amount: unloading.amount, basis: unloading.basis },
            invoiceEmail: invoiceEmail || null,
            contactPhone: /^[6-9]\d{9}$/.test(String(contactPhone || '')) ? String(contactPhone) : null,
            gstin: cleanGstin || null,
            company: company || null,
            attribution: attribution.sanitise(utms),
            // `amount` is what this payment must be worth; `orderTotal` is what the order is worth.
            // They are equal on a full payment and differ on a ppcod one, and conflating them is how
            // a 25% advance gets verified against a 100% expectation.
            amount: rupees,
            orderTotal,
            balanceDue: paymentMode === 'ppcod' ? balanceFor(orderTotal) : 0,
            currency: 'INR',
            status: 'PENDING',
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      )
      .catch((err) => request.log.error({ err: err.message }, 'could not record pending order'));

    return {
      razorpayOrderId: rzp.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: razorpay.keyId(),
      // Shown on the Razorpay modal so the customer sees what they are paying for.
      totalQuantity: cart.totalQuantity,
      // Echoed back so the page can show what was actually charged rather than what it guessed.
      paymentMode,
      goodsTotal,
      unloading,
      orderTotal,
      balanceDue: paymentMode === 'ppcod' ? balanceFor(orderTotal) : 0,
    };
  });

  // POST /api/payment/razorpay/complete
  fastify.post('/razorpay/complete', async (request, reply) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = request.body || {};

    // 1. Proof. Everything in this request came from the customer's browser.
    if (!razorpay.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
      request.log.error({ razorpayOrderId }, 'payment signature verification failed');
      return reply.code(400).send({ error: 'Payment could not be verified' });
    }

    // 2. Idempotency. Razorpay retries, customers double-click, and the handler can fire twice on a
    //    flaky connection — none of which may create a second Shopify order.
    const existing = await orders().findOne({ razorpayPaymentId });
    if (existing?.shopifyOrderName) {
      return { orderName: existing.shopifyOrderName, alreadyProcessed: true };
    }

    const pending = await orders().findOne({ razorpayOrderId });
    if (!pending) {
      request.log.error({ razorpayOrderId }, 'payment for an order we never created');
      return reply.code(400).send({ error: 'We could not match that payment to an order' });
    }
    if (pending.customerId !== request.customer.id) {
      // Somebody else's order id. The signature proves a real payment, not whose it is.
      return reply.code(403).send({ error: 'That payment belongs to another account' });
    }

    // 3. Confirm with Razorpay directly, and that the amount matches what we asked for.
    const payment = await razorpay.fetchPayment(razorpayPaymentId).catch(() => null);
    const expectedPaise = razorpay.toPaise(pending.amount);
    if (!payment || !['captured', 'authorized'].includes(payment.status)) {
      return reply.code(400).send({ error: 'Payment is not complete' });
    }
    if (Number(payment.amount) !== expectedPaise) {
      request.log.error(
        { paid: payment.amount, expected: expectedPaise },
        'payment amount does not match the order',
      );
      return reply.code(400).send({ error: 'Payment amount did not match the order' });
    }

    // 4. Build the Shopify order from the CART, not from anything the browser sent.
    const cartData = await storefrontGraphql(CART_FOR_CHECKOUT, { id: pending.cartId });
    const cart = cartData?.cart;
    if (!cart?.lines?.nodes?.length) {
      return reply.code(409).send({ error: 'Your cart changed. Please contact us with your payment id.' });
    }

    const meta = await addressMeta.loadMany(fastify.mongo.db, request.customer.id);
    const access = meta.get(addressMeta.addressKey(pending.addressId)) || {};

    // The postal addresses themselves, read from the customer record rather than trusted from the
    // browser. Until now the draft carried neither, so every order arrived with the floor and lift
    // attributes but nowhere to deliver them to.
    const addressData = await adminGraphql(
      // provinceCode and countryCodeV2, not province and country: MailingAddressInput on this API
      // version only accepts the codes, and a state NAME in provinceCode is a userError raised after
      // the money has moved.
      `query customerAddresses($id: ID!) {
         customer(id: $id) {
           addresses {
             id firstName lastName company address1 address2 city provinceCode countryCodeV2 zip phone
           }
         }
       }`,
      { id: request.customer.id },
    ).catch(() => null);

    const byKey = new Map(
      (addressData?.customer?.addresses || []).map((a) => [addressMeta.addressKey(a.id), a]),
    );
    const asInput = (a) =>
      a && {
        firstName: a.firstName || '',
        lastName: a.lastName || '',
        company: a.company || '',
        address1: a.address1 || '',
        address2: a.address2 || '',
        city: a.city || '',
        zip: a.zip || '',
        phone: a.phone || '',
        provinceCode: a.provinceCode || null,
        countryCode: a.countryCodeV2 || 'IN',
      };
    const shipTo = asInput(byKey.get(addressMeta.addressKey(pending.addressId)));
    // No billing address chosen means it is the delivery one.
    const billTo =
      asInput(byKey.get(addressMeta.addressKey(pending.billingAddressId || pending.addressId))) ||
      shipTo;

    const draftInput = {
      purchasingEntity: { customerId: request.customer.id },
      // No price overrides: Shopify prices the variants itself, so the order total is derived
      // from the catalogue rather than from anything that travelled through the browser.
      lineItems: cart.lines.nodes.map((line) => ({
        variantId: line.merchandise.id,
        quantity: line.quantity,
        customAttributes: (line.attributes || []).map(({ key, value }) => ({ key, value })),
      })),
      ...(cart.discountCodes?.[0]?.applicable
        ? { appliedDiscount: { title: cart.discountCodes[0].code, value: 0, valueType: 'FIXED_AMOUNT' } }
        : {}),
      // The delivery attributes the warehouse needs, on the order itself — a picker reading the
      // slip should not have to look anywhere else to know it is four floors and no lift.
      customAttributes: [
        { key: 'Razorpay payment', value: String(razorpayPaymentId) },
        // Which service was bought. Ground and doorstep are two different jobs for the crew, and
        // until this line existed the choice never left the browser.
        { key: 'Unloading', value: pending.deliveryOption === 'doorstep' ? 'Doorstep' : 'Ground floor' },
        // The charge, in words, next to the shipping line that carries it. If Shopify ever rejects
        // that line this attribute is the only remaining record of money already collected.
        ...(pending.unloading?.amount
          ? [{ key: 'Unloading charge', value: `INR ${pending.unloading.amount} (${pending.unloading.basis})` }]
          : []),
        // A doorstep order we could not price is a phone call before dispatch, not a free carry.
        ...(pending.deliveryOption === 'doorstep' && !pending.unloading?.amount
          ? [{ key: 'Unloading charge', value: 'To be confirmed before dispatch' }]
          : []),
        ...(pending.gstin
          ? [
              { key: 'GSTIN', value: pending.gstin },
              ...(pending.company ? [{ key: 'Company', value: pending.company }] : []),
            ]
          : []),
        ...(pending.invoiceEmail ? [{ key: 'Invoice email', value: pending.invoiceEmail }] : []),
        // The number the driver actually calls -- not always the address's or the account's.
        ...(pending.contactPhone ? [{ key: 'Delivery contact', value: pending.contactPhone }] : []),
        // utm_source / utm_medium / utm_campaign and friends, under their own names. This is what
        // makes "which campaign paid for this revenue?" answerable from the Shopify order itself --
        // until now the only attribution anywhere was a tag written once at signup.
        ...attribution.asOrderAttributes(pending.attribution),
        // The two numbers the delivery crew needs, in rupees, on the order itself: what has already
        // been paid, and what they must collect at the door.
        ...(pending.paymentMode === 'ppcod'
          ? [
              { key: 'Advance paid', value: `INR ${pending.amount}` },
              { key: 'Balance due on delivery', value: `INR ${pending.balanceDue}` },
            ]
          : []),
        access.floor !== null && access.floor !== undefined
          ? { key: 'Floor', value: String(access.floor) }
          : null,
        typeof access.liftAvailable === 'boolean'
          ? { key: 'Lift available', value: access.liftAvailable ? 'Yes' : 'No' }
          : null,
        access.propertyType ? { key: 'Property type', value: access.propertyType } : null,
      ].filter(Boolean),
      ...(shipTo ? { shippingAddress: shipTo } : {}),
      ...(billTo ? { billingAddress: billTo } : {}),
      // The carry as a priced line, so the Shopify order total equals what Razorpay actually took.
      // Without it the order was short by the unloading charge and the books never balanced.
      ...(pending.unloading?.amount
        ? {
            shippingLine: {
              title: `Unloading — ${pending.unloading.basis}`,
              price: String(pending.unloading.amount),
            },
          }
        : {}),
      tags: ['razorpay', pending.paymentMode === 'ppcod' ? 'ppcod' : 'prepaid'],
    };

    const draft = await adminGraphql(DRAFT_CREATE, { input: draftInput });

    let draftErrors = draft?.draftOrderCreate?.userErrors;
    // An address Shopify will not accept (a zip it dislikes, a province code it does not recognise)
    // must not cost a customer an order they have already paid for. Retry once without the
    // addresses: an order in the admin with a note beats a 502 and a support ticket.
    if (draftErrors?.length && (shipTo || billTo)) {
      request.log.error({ draftErrors }, 'draft rejected the addresses, retrying without them');
      const bare = await adminGraphql(DRAFT_CREATE, {
        input: { ...draftInput, shippingAddress: undefined, billingAddress: undefined },
      }).catch(() => null);
      if (bare?.draftOrderCreate?.draftOrder?.id) {
        draft.draftOrderCreate = bare.draftOrderCreate;
        draftErrors = null;
      }
    }
    // Same reasoning one rung further down: if it is the shipping line Shopify objects to, the order
    // still has to exist. It goes in short by the unloading charge, which the 'Unloading charge'
    // attribute above still records, and the log says so loudly.
    if (draftErrors?.length && draftInput.shippingLine) {
      request.log.error({ draftErrors }, 'draft rejected the unloading line, retrying without it');
      const noCarry = await adminGraphql(DRAFT_CREATE, {
        input: { ...draftInput, shippingAddress: undefined, billingAddress: undefined, shippingLine: undefined },
      }).catch(() => null);
      if (noCarry?.draftOrderCreate?.draftOrder?.id) {
        request.log.error(
          { razorpayPaymentId, unloading: pending.unloading?.amount },
          'ORDER IS SHORT THE UNLOADING CHARGE — collected by Razorpay, not on the Shopify order',
        );
        draft.draftOrderCreate = noCarry.draftOrderCreate;
        draftErrors = null;
      }
    }
    if (draftErrors?.length || !draft?.draftOrderCreate?.draftOrder?.id) {
      request.log.error({ draftErrors }, 'draft order creation failed after payment');
      return reply.code(502).send({
        error: 'Payment received, but the order could not be created. We will contact you.',
      });
    }

    // paymentPending decides whether Shopify calls the order paid. A ppcod order is NOT paid: it is
    // worth the full total with an advance against it, and marking it paid would hide a balance the
    // driver still has to collect.
    const completed = await adminGraphql(
      `mutation complete($id: ID!, $pending: Boolean!) {
         draftOrderComplete(id: $id, paymentPending: $pending) {
           draftOrder { order { id name } }
           userErrors { field message }
         }
       }`,
      { id: draft.draftOrderCreate.draftOrder.id, pending: pending.paymentMode === 'ppcod' },
    );

    const order = completed?.draftOrderComplete?.draftOrder?.order;
    if (!order?.name) {
      request.log.error(
        { errors: completed?.draftOrderComplete?.userErrors },
        'draft completion failed after payment',
      );
      return reply.code(502).send({
        error: 'Payment received, but the order could not be created. We will contact you.',
      });
    }

    // 5. Empty the cart. The order exists, so anything still in the basket is a second purchase
    //    waiting to happen -- the customer used to land on the success page with the header badge
    //    still counting the items they had just bought. After the order, never before: a cart
    //    cleared ahead of a failed draft would lose the customer both the order and the basket.
    //    Best-effort by design; a cart that will not empty must not turn a paid order into a 502.
    await storefrontGraphql(CART_EMPTY, {
      cartId: pending.cartId,
      lineIds: cart.lines.nodes.map((line) => line.id),
    }).catch((err) => request.log.error({ err: err.message }, 'order placed but cart not emptied'));

    // 6. Record it. The unique index on razorpayPaymentId is what makes step 2 reliable.
    await orders()
      .updateOne(
        { razorpayOrderId },
        {
          $set: {
            razorpayPaymentId,
            shopifyOrderId: order.id,
            shopifyOrderName: order.name,
            // PAID means nothing is owed. An advance leaves a balance, and calling that PAID would
            // make the reconciliation report agree with itself and disagree with the driver.
            status: pending.paymentMode === 'ppcod' ? 'ADVANCE_PAID' : 'PAID',
            paidAt: new Date(),
            updatedAt: new Date(),
          },
        },
      )
      .catch((err) => request.log.error({ err: err.message }, 'order recorded in Shopify but not here'));

    return { orderName: order.name, orderId: order.id };
  });
};
