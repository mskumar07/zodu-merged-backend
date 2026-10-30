// Fixed-window rate limiter (as in the POC) on a shared store, so every replica
// counts against the same budget. Redis in production; the in-memory store is
// for local runs and tests only.
//
// If the store fails the request is let through: a Redis outage must not take
// file downloads down with it.

const { httpError } = require('../storage/key-builder');
const { logger } = require('../utils/logger');

function createMemoryStore() {
  const hits = new Map();
  return {
    async hit(key, windowMs) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      return { count: entry.count, resetMs: entry.resetAt - now };
    },
  };
}

function createRedisStore(redis) {
  return {
    async hit(key, windowMs) {
      const [[, count], , [, ttl]] = await redis.multi()
        .incr(key)
        .pexpire(key, windowMs, 'NX')
        .pttl(key)
        .exec();
      return { count, resetMs: ttl > 0 ? ttl : windowMs };
    },
  };
}

function rateLimit({ store, windowMs, max, name, key }) {
  return async (req, res, next) => {
    let result;
    try {
      result = await store.hit(`rl:file:${name}:${key(req)}`, windowMs);
    } catch (err) {
      logger.warn({ err: err.message }, 'rate-limit store unavailable, allowing request');
      return next();
    }
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - result.count));
    if (result.count > max) {
      const retryAfter = Math.max(1, Math.ceil(result.resetMs / 1000));
      res.setHeader('Retry-After', retryAfter);
      return next(httpError(429, `Too many ${name} requests, try again in ${retryAfter}s`));
    }
    next();
  };
}

module.exports = { rateLimit, createMemoryStore, createRedisStore };
