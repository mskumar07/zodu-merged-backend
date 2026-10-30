// Rate limits shared by every replica: counters live in Redis (fixed window).
// Without a Redis client they fall back to memory (local development, tests).
//
// If Redis is down, requests are let through (and logged by the store's
// caller): losing rate limiting for a few minutes is better than refusing
// every request.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// express-rate-limit store on an ioredis-compatible client.
// One MULTI per hit: INCR, start the window on the first hit, read what's left of it.
class RedisWindowStore {
  constructor({ redis, prefix }) {
    this.redis = redis;
    this.prefix = prefix;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const k = this.prefix + key;
    const res = await this.redis.multi().incr(k).pexpire(k, this.windowMs, 'NX').pttl(k).exec();
    if (!res) throw new Error('rate-limit transaction aborted');
    const [[incrErr, totalHits], , [ttlErr, ttl]] = res;
    if (incrErr || ttlErr) throw incrErr || ttlErr;
    return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }

  async decrement(key) {
    await this.redis.decr(this.prefix + key);
  }

  async resetKey(key) {
    await this.redis.del(this.prefix + key);
  }
}

const tooMany = (req, res, _next, options) => {
  res.status(options.statusCode).json({ success: false, message: 'Too many requests, please try again later.' });
};

// Per client IP. IPv6 addresses are grouped by /56, so one host can't rotate
// through its own address block. req.ip is only right when 'trust proxy' is.
const byIp = (req) => ipKeyGenerator(req.ip);

// name       Redis key prefix; also tells limits apart in the logs
// limit      requests per window
// windowMs   default one minute
// key        (req) => string; default: client IP
function createRateLimit({ name, limit, windowMs = 60_000, redis, key = byIp, skip, onStoreError } = {}) {
  if (!name) throw new Error('createRateLimit: name is required');
  let store;
  if (redis) {
    const inner = new RedisWindowStore({ redis, prefix: `rl:${name}:` });
    // Report the failure, then let express-rate-limit pass the request (passOnStoreError).
    store = {
      init: (o) => inner.init(o),
      increment: (k) => inner.increment(k).catch((err) => { onStoreError?.(err, name); throw err; }),
      decrement: (k) => inner.decrement(k).catch(() => {}),
      resetKey: (k) => inner.resetKey(k),
    };
  }
  return rateLimit({
    windowMs,
    limit,
    store,
    keyGenerator: key,
    skip,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    passOnStoreError: true,
    handler: tooMany,
    // The checks run on the first request; their warnings are for misconfigured
    // trust proxy, which applySecurity sets explicitly.
    validate: { trustProxy: false, xForwardedForHeader: false },
  });
}

module.exports = { createRateLimit, RedisWindowStore, byIp };
