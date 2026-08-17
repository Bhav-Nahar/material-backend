/**
 * What the doorstep carry costs. THE SERVER'S COPY, and the one that decides money.
 *
 * The frontend has the same table in `material-frontend/src/lib/delivery-charges.js` so the shipping
 * page can quote a number before anything is submitted. That copy is a QUOTE; this one is the CHARGE.
 * They must agree, and `test/delivery-charges.test.js` reads the frontend file and fails if the rates
 * drift apart -- a quote that disagrees with the bill is the failure this module exists to prevent.
 *
 * ponytail: two copies rather than a shared package, because the two apps are separate node projects
 * with different module systems. The parity test is what makes that safe; if a third consumer ever
 * appears, extract a package then.
 */
const DELIVERY_OPTIONS = ['ground', 'doorstep'];

// PLACEHOLDER — confirm with operations. Keep in sync with the frontend copy.
const RATE_PER_100KG_PER_FLOOR = 120; // no lift, per floor climbed
const RATE_PER_100KG_WITH_LIFT = 90; // flat, regardless of floor
const GROUND_FLOOR_HANDLING = 150; // per 100kg, even with no stairs
const MINIMUM_DOORSTEP_CHARGE = 300;

/**
 * @returns {{ amount: number, basis: string, needsConfirmation: boolean }}
 *
 * `needsConfirmation` means we cannot price the job from what we know (no floor, or no answer on the
 * lift above ground). Nothing is charged in that case -- the crew's quote is a phone call, and
 * billing a guess is worse than billing later.
 */
function unloadingCharge({ option, weightKg, floor, liftAvailable }) {
  if (option !== 'doorstep') {
    return { amount: 0, basis: 'Unloaded at the entrance', needsConfirmation: false };
  }

  const units = Math.max(1, Math.ceil(Number(weightKg || 0) / 100));

  if (floor === null || floor === undefined || floor === '') {
    return { amount: 0, basis: 'Confirmed before dispatch', needsConfirmation: true };
  }

  const floorNum = Number(floor);
  if (floorNum === 0) {
    return {
      amount: Math.max(MINIMUM_DOORSTEP_CHARGE, units * GROUND_FLOOR_HANDLING),
      basis: `${weightKg} kg, ground floor`,
      needsConfirmation: false,
    };
  }

  if (typeof liftAvailable !== 'boolean') {
    return { amount: 0, basis: 'Confirmed before dispatch', needsConfirmation: true };
  }

  const amount = liftAvailable
    ? units * RATE_PER_100KG_WITH_LIFT
    : units * RATE_PER_100KG_PER_FLOOR * floorNum;

  return {
    amount: Math.max(MINIMUM_DOORSTEP_CHARGE, Math.round(amount)),
    basis: liftAvailable
      ? `${weightKg} kg, floor ${floorNum}, by lift`
      : `${weightKg} kg, ${floorNum} ${floorNum === 1 ? 'flight' : 'flights'} by stair`,
    needsConfirmation: false,
  };
}

module.exports = {
  unloadingCharge,
  DELIVERY_OPTIONS,
  RATES: {
    RATE_PER_100KG_PER_FLOOR,
    RATE_PER_100KG_WITH_LIFT,
    GROUND_FLOOR_HANDLING,
    MINIMUM_DOORSTEP_CHARGE,
  },
};
