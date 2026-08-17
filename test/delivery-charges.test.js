// The unloading charge, and the thing that keeps it honest: the frontend quotes it on the shipping
// page and this module bills it. If the two tables drift, the customer is quoted one number and
// charged another -- which is the bug this file exists to catch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { unloadingCharge, RATES } = require('../lib/deliveryCharges');

test('ground floor service is free', () => {
  const q = unloadingCharge({ option: 'ground', weightKg: 900, floor: 4, liftAvailable: false });
  assert.equal(q.amount, 0);
  assert.equal(q.needsConfirmation, false);
});

test('doorstep with an unknown floor is not priced, and says so', () => {
  const q = unloadingCharge({ option: 'doorstep', weightKg: 900, floor: null });
  assert.equal(q.amount, 0);
  assert.equal(q.needsConfirmation, true);
});

test('doorstep above ground with no answer on the lift is not priced', () => {
  const q = unloadingCharge({ option: 'doorstep', weightKg: 900, floor: 4, liftAvailable: null });
  assert.equal(q.amount, 0);
  assert.equal(q.needsConfirmation, true);
});

test('stairs cost more than a lift, and both clear the minimum', () => {
  const stairs = unloadingCharge({ option: 'doorstep', weightKg: 900, floor: 4, liftAvailable: false });
  const lift = unloadingCharge({ option: 'doorstep', weightKg: 900, floor: 4, liftAvailable: true });
  // 9 units x 120 x 4 floors, against 9 units x 90 flat.
  assert.equal(stairs.amount, 4320);
  assert.equal(lift.amount, 810);
  assert.ok(stairs.amount > lift.amount);
});

test('a small order still pays the minimum', () => {
  const q = unloadingCharge({ option: 'doorstep', weightKg: 5, floor: 1, liftAvailable: true });
  assert.equal(q.amount, RATES.MINIMUM_DOORSTEP_CHARGE);
});

test('ground floor at a doorstep address is handling, not a climb', () => {
  const q = unloadingCharge({ option: 'doorstep', weightKg: 900, floor: 0 });
  assert.equal(q.amount, 9 * RATES.GROUND_FLOOR_HANDLING);
});

test('the frontend quote table matches this one', () => {
  const frontend = fs.readFileSync(
    path.join(__dirname, '../../material-frontend/src/lib/delivery-charges.js'),
    'utf8',
  );
  for (const [name, value] of Object.entries(RATES)) {
    const match = frontend.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    assert.ok(match, `${name} is missing from the frontend copy`);
    assert.equal(
      Number(match[1]),
      value,
      `${name} differs: frontend quotes ${match[1]}, the server bills ${value}`,
    );
  }
});
