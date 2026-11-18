// Per-user limits (§10.2): item updates 120/min, photo uploads 30/min.
// Shared through Redis when REDIS_URL is set; per process otherwise.
const { createRateLimit } = require('@zodu/security');
const config = require('../config');
const { logger } = require('./logger');

let redis;
if (config.REDIS_URL && process.env.NODE_ENV !== 'test') {
  const Redis = require('ioredis');
  redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  let last = 0;
  redis.on('error', (err) => {
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    logger.warn('rate-limit redis error', { error: err.message });
  });
}

// Behind the route policy: every request here has a verified user.
const byUser = (req) => `u:${req.auth.userId}`;
const onStoreError = (err, name) => logger.warn('rate-limit store error', { limit: name, error: err.message });

const itemUpdates = createRateLimit({ name: 'ckl2-items', limit: 120, redis, key: byUser, onStoreError });
const photoUploads = createRateLimit({ name: 'ckl2-photos', limit: 30, redis, key: byUser, onStoreError });

module.exports = { itemUpdates, photoUploads };
