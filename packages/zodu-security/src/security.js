// applySecurity(app): the baseline every Express app gets.
//
//   - no x-powered-by; helmet security headers (API defaults)
//   - 'trust proxy' set to the exact number of proxies in front, so req.ip
//     can't be spoofed with X-Forwarded-For
//   - X-Request-Id
//   - CORS from an allowlist (CORS_ORIGINS), never '*' with credentials
//   - per-IP rate limit (Redis-backed when a client is given)
//   - JSON / urlencoded bodies capped at 100kb (raise per route where needed)
//
// setServerTimeouts(server) bounds slow clients (slowloris).

const helmet = require('helmet');
const cors = require('cors');
const { requestId } = require('./request-id');
const { createRateLimit } = require('./rate-limit');

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// '1' → 1 hop; 'loopback, uniquelocal' → subnets; 'false' / '0' → none.
function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return list(value);
}

const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Branch-Id', 'X-Client-Platform', 'X-Request-Id'];
const EXPOSED_HEADERS = ['Content-Disposition', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining',
  'RateLimit-Reset', 'X-Request-Id'];

// Requests without an Origin (Flutter, Electron main process, curl, other
// services) pass untouched: CORS only governs browsers. A browser origin that
// isn't listed gets no Access-Control-Allow-Origin, so the browser blocks the response.
function corsAllowlist(origins = list(process.env.CORS_ORIGINS)) {
  const allowed = new Set(origins.map((o) => o.replace(/\/+$/, '')));
  if (allowed.has('*')) throw new Error('CORS_ORIGINS must list origins, not "*" (credentials are allowed)');
  return cors({
    origin: (origin, cb) => cb(null, Boolean(origin) && allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: 600,
  });
}

// JSON APIs: nothing may frame or run anything from these responses.
// Cross-origin resource policy is 'cross-origin' because the web, desktop and
// mobile apps load images from the API host (file-service sets its own).
const HELMET = {
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS is set by the HTTPS proxy in front (docs/security/README.md).
  strictTransportSecurity: false,
};

function applySecurity(app, {
  express,
  trustProxy = process.env.TRUST_PROXY,
  corsOrigins = list(process.env.CORS_ORIGINS),
  cors: useCors = true,
  bodyLimit = '100kb',
  parseBodies = true,
  redis,
  ipLimitPerMinute = Number(process.env.RATE_LIMIT_IP_PER_MIN) || 600,
  onStoreError,
  helmetOptions = HELMET,
} = {}) {
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(trustProxy));
  app.use(requestId());
  app.use(helmet(helmetOptions));
  if (useCors) app.use(corsAllowlist(corsOrigins));
  if (ipLimitPerMinute > 0) {
    app.use(createRateLimit({ name: 'ip', limit: ipLimitPerMinute, redis, onStoreError }));
  }
  if (parseBodies) {
    if (!express) throw new Error('applySecurity: pass { express } to parse bodies');
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  }
  return app;
}

function setServerTimeouts(server, {
  headersTimeout = 20_000,
  requestTimeout = 120_000,
  keepAliveTimeout = 65_000,
} = {}) {
  server.headersTimeout = headersTimeout;
  server.requestTimeout = requestTimeout;
  // Longer than the proxy in front keeps idle connections, so it never reuses a closed one.
  server.keepAliveTimeout = keepAliveTimeout;
  return server;
}

module.exports = { applySecurity, setServerTimeouts, corsAllowlist, parseTrustProxy, HELMET, list };
