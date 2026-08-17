// Per-phone limits on send-otp. The global @fastify/rate-limit in index.js caps by
// IP, which does nothing about one attacker cycling IPs against one number, or
// about your MSG91 bill.
//
// ponytail: in-process Map, so the limits are per instance — two instances behind a
// load balancer means double the allowance. Correct for one Cloud Run container.
// Move to Redis when you scale past one, or if you want the counters to survive a
// deploy. The Map also only sheds a number's history when that number comes back,
// so it grows with distinct callers until the process restarts; a few MB per 100k
// numbers, which the same Redis move fixes for good.
const COOLDOWN_MS = 60 * 1000;
const DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const log = new Map(); // mobile91 -> number[] of send timestamps

const prune = (times, now) => times.filter((t) => now - t < DAY_MS);

// Returns null if the send is allowed, otherwise { retryAfter, reason }.
function check(mobile91, now = Date.now()) {
  const times = prune(log.get(mobile91) || [], now);

  const last = times[times.length - 1];
  if (last && now - last < COOLDOWN_MS) {
    return { retryAfter: Math.ceil((COOLDOWN_MS - (now - last)) / 1000), reason: 'cooldown' };
  }
  if (times.length >= DAILY_LIMIT) {
    return { retryAfter: Math.ceil((times[0] + DAY_MS - now) / 1000), reason: 'daily_limit' };
  }
  return null;
}

function record(mobile91, now = Date.now()) {
  const times = prune(log.get(mobile91) || [], now);
  times.push(now);
  log.set(mobile91, times);
}

module.exports = { check, record, COOLDOWN_MS, DAILY_LIMIT };
