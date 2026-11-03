// Wires the token machinery together once at startup (initAuth) and hands it
// to routes and services (auth()). auth-service verifies its own access
// tokens with its in-memory public keys rather than fetching its own JWKS.

const Redis = require('ioredis');
const { createAuthenticate, createAccessTokenVerifier } = require('@zodu/security');
const config = require('../config');
const { logger } = require('../utils/logger');
const { loadKeys } = require('./keys');
const { createAccessTokenIssuer } = require('./access-token');
const { createRefreshStore } = require('./refresh-store');
const { createLockout } = require('./lockout');
const { createPasswordReset } = require('./password-reset');
const { initPasswords } = require('./password');

let redisClient;
let state;

// Refresh tokens, lockouts and rate-limit counters live here, shared by every
// replica. Commands queue briefly while reconnecting, then fail (500/503).
function getRedis() {
  if (redisClient) return redisClient;
  if (!config.REDIS_URL) throw new Error('REDIS_URL is required (refresh-token sessions are kept in Redis)');
  redisClient = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5_000 });
  let lastLog = 0;
  redisClient.on('error', (err) => {
    if (Date.now() - lastLog > 60_000) { lastLog = Date.now(); logger.error({ err: err.message }, '[redis]'); }
  });
  return redisClient;
}

// Same error body as the rest of auth-service's routes.
const respond = (req, res, status, message) => res.status(status).json({ message });

async function initAuth({ redis = getRedis() } = {}) {
  const keys = await loadKeys(config);
  await initPasswords();
  const verifier = createAccessTokenVerifier({
    keySet: keys.keySet,
    issuer: config.JWT_ISSUER || undefined,
    audience: config.JWT_AUDIENCE || undefined,
    redis,
    onError: (err) => logger.error({ err: err.message }, 'access-token check'),
  });
  state = {
    keys,
    redis,
    tokens: createAccessTokenIssuer({ keys, config }),
    store: createRefreshStore({
      redis,
      idleSeconds: config.REFRESH_IDLE_DAYS * 86_400,
      maxSeconds: config.SESSION_MAX_DAYS * 86_400,
      graceSeconds: config.REFRESH_REUSE_GRACE_SECONDS,
      accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    }),
    lockout: createLockout({
      redis,
      maxFailures: config.LOGIN_MAX_FAILURES,
      lockMinutes: config.LOGIN_LOCKOUT_MINUTES,
    }),
    passwordReset: createPasswordReset({
      redis,
      codeTtlSeconds: config.PASSWORD_RESET_CODE_TTL_SECONDS,
      resendSeconds: config.PASSWORD_RESET_RESEND_SECONDS,
      maxSendsPerHour: config.PASSWORD_RESET_MAX_SENDS_PER_HOUR,
      maxAttempts: config.PASSWORD_RESET_MAX_ATTEMPTS,
      tokenTtlSeconds: config.PASSWORD_RESET_TOKEN_TTL_SECONDS,
    }),
    ...createAuthenticate({ verifier, respond }),
  };
  if (!config.LEGACY_REFRESH_CUTOFF) {
    logger.warn('LEGACY_REFRESH_CUTOFF not set: pre-ES256 refresh tokens are still exchanged');
  }
  return state;
}

function auth() {
  if (!state) throw new Error('initAuth() has not run');
  return state;
}

// Route middleware usable before initAuth() has finished (routers are built at require time).
function authenticate(req, res, next) {
  return auth().authenticate(req, res, next);
}

module.exports = { initAuth, auth, authenticate, getRedis };
