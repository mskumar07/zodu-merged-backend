require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { applySecurity, createRateLimit, setServerTimeouts, list } = require('@zodu/security');

// The only public entry point. It does not verify tokens (each service does:
// defence in depth); it blocks what must never be reachable from outside,
// sets security headers, CORS and rate limits, and forwards the client IP and
// a request id to the services.

const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGINS = list(process.env.CORS_ORIGINS);
// Largest upload any service accepts (25MB) plus multipart overhead.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 26 * 1024 * 1024;
// Time a service may take to answer (reports, exports).
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS) || 120_000;

if (NODE_ENV === 'production' && !CORS_ORIGINS.length) {
  // Fail loudly: without the list every browser origin would be refused.
  console.error('CORS_ORIGINS is required in production (comma-separated web app origins)');
  process.exit(1);
}

// Shared rate-limit counters across gateway replicas. Commands fail fast while
// Redis is down; the limiters then let requests through.
let redis;
if (process.env.REDIS_URL) {
  const Redis = require('ioredis');
  redis = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  let lastLog = 0;
  redis.on('error', (err) => {
    if (Date.now() - lastLog > 60_000) { lastLog = Date.now(); console.error('[redis]', err.message); }
  });
} else if (NODE_ENV === 'production') {
  console.warn('REDIS_URL not set: rate limits are per gateway instance');
}
const onStoreError = () => {};   // logged once a minute by the redis error handler

const app = express();

applySecurity(app, {
  express,
  parseBodies: false,             // bodies are streamed to the services untouched
  corsOrigins: CORS_ORIGINS,
  redis,
  onStoreError,
  // One HTTPS reverse proxy in front by default (TRUST_PROXY=1).
  trustProxy: process.env.TRUST_PROXY,
});

// ── Paths that never leave the private network ─────────────────────────────
//   /{svc}/internal/*      service-to-service routes
//   /{svc}/delete/file/*   old delete routes, except DELETE on retail / restaurant:
//                          the apps call it when an image is removed before saving,
//                          and it now only discards uploads no saved record uses
//   /{svc}/file/*          old file routes: only GET/HEAD, which go read-only to file-service
//   '.' / '..' segments, backslashes, control characters, malformed escapes
// The path is decoded (up to 3 times) before the checks, so /auth/%69nternal,
// /auth/%2569nternal or /auth%2Finternal can't slip past. Encoded slashes are
// otherwise allowed: document numbers such as INV/25-26/001 appear in paths.
const LEGACY_FILE_SERVICES = new Set(['auth', 'employee', 'restaurant', 'retail', 'checklist']);
const DISCARD_UPLOAD_SERVICES = new Set(['restaurant', 'retail']);

function decodePath(raw) {
  let p = raw;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(p); i++) p = decodeURIComponent(p);
  if (/%[0-9a-f]{2}/i.test(p)) throw new Error('too deeply encoded');
  return p;
}

function isBlockedPath(rawPath, method = 'GET') {
  let p;
  try {
    p = decodePath(rawPath);
  } catch {
    return true;   // malformed escapes: refuse rather than guess
  }
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return true;
  if (p.split('/').some((s) => s === '.' || s === '..')) return true;
  const n = path.posix.normalize(p).toLowerCase();
  if (/^\/+[^/]+\/internal(\/|;|$)/.test(n)) return true;
  const del = n.match(/^\/+([^/]+)\/delete\/file(\/|;|$)/);
  if (del) return !(DISCARD_UPLOAD_SERVICES.has(del[1]) && method === 'DELETE');
  const file = n.match(/^\/+([^/]+)\/file(\/|;|$)/);
  if (file) return !(LEGACY_FILE_SERVICES.has(file[1]) && (method === 'GET' || method === 'HEAD'));
  return false;
}

const notFound = (res) => res.status(404).json({ error: 'Not found' });

app.use((req, res, next) => {
  if (isBlockedPath(req.originalUrl.split('?')[0], req.method)) return notFound(res);
  // Only services talk to each other with these headers; a client must never set them.
  delete req.headers['x-internal-token'];
  delete req.headers['x-internal-key'];
  // Uploads are streamed, so cap them by their declared size. Chunked bodies
  // are capped by the service that parses them (multer / express.json limits).
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  next();
});

// Sign-up and token routes: much tighter than the global per-IP limit.
// auth-service adds per-account lockout and its own per-IP limits on top.
const authLimit = createRateLimit({
  name: 'auth',
  limit: Number(process.env.AUTH_RATE_LIMIT_PER_MIN) || 30,
  redis,
  onStoreError,
});
app.use(['/auth/api/login', '/auth/api/create-account', '/auth/api/refresh-token'], authLimit);

// File responses carry file-service's own headers: a PDF must open in the
// browser's viewer (a CSP of default-src 'none' would block it) and may be
// shown in the apps' frames (X-Frame-Options would block that).
app.use(['/files', ...[...LEGACY_FILE_SERVICES].map((s) => `/${s}/file`)], (req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Frame-Options');
  next();
});

const AUTH_SERVICE_URL       = process.env.AUTH_SERVICE_URL       || 'http://auth-service:4000';
const RETAIL_SERVICE_URL     = process.env.RETAIL_SERVICE_URL     || 'http://retail-service:4001';
const EMPLOYEE_SERVICE_URL   = process.env.EMPLOYEE_SERVICE_URL   || 'http://employee-service:4002';
const RESTAURANT_SERVICE_URL = process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4003';
const CHECKLIST_SERVICE_URL  = process.env.CHECKLIST_SERVICE_URL  || 'http://checklist-service:4005';
const ADMIN_SERVICE_URL      = process.env.ADMIN_SERVICE_URL      || 'http://admin-service:4006';
const FILE_SERVICE_URL       = process.env.FILE_SERVICE_URL       || 'http://file-service:4007';

const proxyError = (serviceName) => (err, req, res) => {
  console.error(`[${serviceName}] proxy error:`, err.message);
  if (!res.headersSent) res.status(502).json({ error: `${serviceName} unavailable` });
};

// CORS is answered here only. Several services still run cors() with '*';
// their Access-Control-* headers would override the allowlist above.
function dropUpstreamCors(proxyRes) {
  for (const name of Object.keys(proxyRes.headers)) {
    if (name.startsWith('access-control-')) delete proxyRes.headers[name];
  }
}

// xfwd passes the client IP on (X-Forwarded-For), so services see real clients.
const proxy = (target, serviceName, extra = {}) => createProxyMiddleware({
  target,
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: PROXY_TIMEOUT_MS,
  timeout: PROXY_TIMEOUT_MS,
  on: { error: proxyError(serviceName), proxyRes: dropUpstreamCors },
  ...extra,
});

// Files stored before file-service are referenced by full URLs in the services'
// tables (/auth/file/<key>, /checklist/file/<folder>/<key>, ...). file-service
// serves them read-only from the old bucket. Must come before the service proxies.
const legacyFiles = proxy(FILE_SERVICE_URL, 'file-service', { pathRewrite: (p) => `/legacy${p}` });
for (const service of LEGACY_FILE_SERVICES) {
  app.use(`/${service}/file`, legacyFiles);
}

app.use('/auth', proxy(AUTH_SERVICE_URL, 'auth-service'));
app.use('/retail', proxy(RETAIL_SERVICE_URL, 'retail-service'));
app.use('/checklist', proxy(CHECKLIST_SERVICE_URL, 'checklist-service'));
app.use('/employee', proxy(EMPLOYEE_SERVICE_URL, 'employee-service'));
app.use('/restaurant', proxy(RESTAURANT_SERVICE_URL, 'restaurant-service'));
// Admin console. admin-service has no public port; the gateway is its only door.
app.use('/admin', proxy(ADMIN_SERVICE_URL, 'admin-service'));
// Central file storage.
app.use('/files', proxy(FILE_SERVICE_URL, 'file-service'));
// payroll-service is deliberately not proxied: its only non-internal route
// (GET /api/salary) is used by no client; employee-service calls it internally.

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => {
  res.send('Welcome to the API Gateway!');
});

app.use((req, res) => notFound(res));

if (require.main === module) {
  const PORT = process.env.PORT || 5001;
  const server = app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
  // Uploads of 25MB on slow mobile links need minutes; headers must arrive fast.
  setServerTimeouts(server, { requestTimeout: 300_000 });
}

module.exports = { app, isBlockedPath };
