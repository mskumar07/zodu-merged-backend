// Service-to-service authentication (/internal/* routes).
//
// Every calling service has its own token. The caller sends it in
// X-Internal-Token; the receiver holds the tokens of the services it accepts
// (INTERNAL_TOKEN_<CALLER>) and so knows exactly which service called. A
// leaked token names its source and can be rotated alone.
//
//   caller:    INTERNAL_TOKEN=<its own token>
//   receiver:  INTERNAL_TOKEN_AUTH=..., INTERNAL_TOKEN_EMPLOYEE=..., ...
//
// No token or an unknown one → 401. A valid token from a service the route
// doesn't accept → 403.

const crypto = require('node:crypto');
const { currentRequestId } = require('./request-id');

const PREFIX = 'INTERNAL_TOKEN_';
// openssl rand -hex 32 → 64 characters. Shorter values are ignored, never accepted.
const MIN_TOKEN_LENGTH = 32;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

// { INTERNAL_TOKEN_AUTH: 'x', INTERNAL_TOKEN_EMPLOYEE: 'y' } → { auth: 'x', employee: 'y' }
function callerTokensFromEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k, v]) => k.startsWith(PREFIX) && typeof v === 'string' && v.length >= MIN_TOKEN_LENGTH)
      .map(([k, v]) => [k.slice(PREFIX.length).toLowerCase(), v]),
  );
}

const defaultRespond = (req, res, status, message) => res.status(status).json({ success: false, message });

function createInternalAuth({ tokens = callerTokensFromEnv(), respond = defaultRespond } = {}) {
  const hashed = Object.entries(tokens)
    .filter(([, t]) => typeof t === 'string' && t.length >= MIN_TOKEN_LENGTH)
    .map(([name, t]) => [name.toLowerCase(), sha256(t)]);

  // Name of the calling service, or null. Compares against every token so the
  // timing doesn't reveal which one matched.
  function identify(req) {
    const presented = req.get('X-Internal-Token');
    if (!presented) return null;
    const digest = sha256(presented);
    let caller = null;
    for (const [name, h] of hashed) {
      if (crypto.timingSafeEqual(digest, h) && !caller) caller = name;
    }
    return caller;
  }

  // requireInternal()                    any known service
  // requireInternal('auth', 'admin')     only these services
  function requireInternal(...callers) {
    const allowed = callers.map((c) => String(c).toLowerCase());
    return function internalOnly(req, res, next) {
      if (req.internalCaller === undefined) req.internalCaller = identify(req);
      if (!req.internalCaller) return respond(req, res, 401, 'Invalid internal token');
      if (allowed.length && !allowed.includes(req.internalCaller)) {
        return respond(req, res, 403, 'Service not allowed');
      }
      return next();
    };
  }

  return { identify, requireInternal, callers: hashed.map(([name]) => name) };
}

// Default instance from this process's environment, built on first use so
// tests and scripts can set the env first.
let defaultAuth;
const requireInternal = (...callers) => {
  defaultAuth ??= createInternalAuth();
  return defaultAuth.requireInternal(...callers);
};

// Headers for an outgoing internal call: this service's token and the current
// request id, so one request can be followed across services in the logs.
function internalHeaders(env = process.env) {
  const headers = {};
  if (env.INTERNAL_TOKEN) headers['X-Internal-Token'] = env.INTERNAL_TOKEN;
  const requestId = currentRequestId();
  if (requestId) headers['X-Request-Id'] = requestId;
  return headers;
}

// axios instance for internal calls: token + request id on every request and
// a timeout, so a stuck service can't hold the caller's request forever.
// Takes the caller's axios so this package doesn't pin an axios version.
function createInternalHttp(axios, { baseURL, timeout = 10_000, headers } = {}) {
  const http = axios.create({ baseURL, timeout, headers });
  http.interceptors.request.use((config) => {
    for (const [k, v] of Object.entries(internalHeaders())) {
      if (typeof config.headers?.set === 'function') config.headers.set(k, v);
      else config.headers = { ...config.headers, [k]: v };
    }
    return config;
  });
  return http;
}

module.exports = {
  callerTokensFromEnv,
  createInternalAuth,
  requireInternal,
  internalHeaders,
  createInternalHttp,
  MIN_TOKEN_LENGTH,
};
