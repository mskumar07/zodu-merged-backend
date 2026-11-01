const config = require('./config');
const { logger } = require('./utils/logger');
const { createApp } = require('./express-app');
const repo = require('./repository/file-repo');
const storage = require('./storage/minio-client');
const { createAuthClient } = require('./clients/auth-client');
const { createMemoryStore, createRedisStore } = require('./middleware/rate-limit');
const { createPurgeJob } = require('./jobs/purge-deleted');
const { createAccessTokenVerifier } = require('@zodu/security');

function checkConfig() {
  const missing = ['MINIO_ACCESSKEY', 'MINIO_SECRETKEY', 'INTERNAL_TOKEN', 'DB_HOSTNAME']
    .filter((k) => !config[k]);
  if ((config.NODE_ENV === 'production' || config.AUTH_CHECK_REVOKED_SESSIONS) && !config.REDIS_URL) missing.push('REDIS_URL');
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  if (!Object.keys(config.INTERNAL_TOKENS).length) {
    logger.warn('No INTERNAL_TOKEN_<CALLER> configured (min 32 chars): /internal/* will refuse every call');
  }
}

function connectRedis() {
  if (!config.REDIS_URL) return null;
  const Redis = require('ioredis');
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', (err) => logger.warn({ err: err.message }, 'Redis error'));
  return redis;
}

function rateLimitStore(redis) {
  if (redis) return createRedisStore(redis);
  logger.warn('REDIS_URL not set: rate limits are per instance (local use only)');
  return createMemoryStore();
}

async function StartServer() {
  checkConfig();
  await storage.assertBucket();
  const redis = connectRedis();

  const app = createApp({
    config,
    repo,
    storage,
    authClient: createAuthClient({
      baseUrl: config.AUTH_SERVICE_URL, token: config.INTERNAL_TOKEN, ttlMs: config.ACCESS_CACHE_TTL_MS,
    }),
    tokenVerifier: createAccessTokenVerifier({
      jwksUrl: config.AUTH_JWKS_URL,
      redis,
      checkRevoked: config.AUTH_CHECK_REVOKED_SESSIONS,
      onError: (err) => logger.warn({ err: err.message }, 'access token check: keys or Redis unavailable'),
    }),
    rateLimitStore: rateLimitStore(redis),
  });

  if (config.PURGE_JOB_ENABLED) {
    createPurgeJob({
      repo, storage, olderThanDays: config.PURGE_AFTER_DAYS, stagingTtlHours: config.STAGING_TTL_HOURS,
    }).start();
  }

  app.listen(config.PORT, () => logger.info(`file-service listening on ${config.PORT} (bucket ${storage.bucket})`));
}

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled rejection');
  process.exit(1);
});

StartServer().catch((err) => {
  logger.fatal({ err: err.message }, 'file-service failed to start');
  process.exit(1);
});
