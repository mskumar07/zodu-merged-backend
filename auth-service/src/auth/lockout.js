// Per-account login lockout (NIST SP 800-63B rate limiting), in Redis so every
// replica counts together. Counted per identifier (email / phone) whatever the
// IP, which also catches credential stuffing spread over many addresses; the
// per-IP limit on the route covers one address trying many accounts.
//
// LOGIN_MAX_FAILURES failures within LOGIN_LOCKOUT_MINUTES lock the identifier
// for LOGIN_LOCKOUT_MINUTES. Keys hold a hash of the identifier, never the
// email or phone itself.

const crypto = require('node:crypto');

function createLockout({ redis, maxFailures, lockMinutes }) {
  const windowSeconds = lockMinutes * 60;
  const id = (identifier) => crypto.createHash('sha256').update(String(identifier).toLowerCase()).digest('base64url');
  const failKey = (identifier) => `login:fail:${id(identifier)}`;
  const lockKey = (identifier) => `login:lock:${id(identifier)}`;

  // Seconds until the identifier may try again; 0 when not locked.
  async function retryAfter(identifier) {
    const ttl = await redis.ttl(lockKey(identifier));
    return ttl > 0 ? ttl : 0;
  }

  // Counts a failure. { locked: true, retryAfter } when this one locks the account.
  async function recordFailure(identifier) {
    const res = await redis.multi()
      .incr(failKey(identifier))
      .expire(failKey(identifier), windowSeconds, 'NX')
      .exec();
    const failures = res?.[0]?.[1] ?? 0;
    if (failures < maxFailures) return { locked: false, failures };
    await redis.multi()
      .set(lockKey(identifier), '1', 'EX', windowSeconds)
      .del(failKey(identifier))
      .exec();
    return { locked: true, failures, retryAfter: windowSeconds };
  }

  const recordSuccess = (identifier) => redis.del(failKey(identifier));

  return { retryAfter, recordFailure, recordSuccess };
}

module.exports = { createLockout };
