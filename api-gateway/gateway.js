require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id', 'X-Request-Id'],
  exposedHeaders: ['Content-Disposition', 'Retry-After', 'RateLimit-Remaining', 'X-Request-Id']
}));

// Service-to-service routes (/auth/internal/*, /files/internal/*, ...) are never
// reachable from outside. The path is decoded and normalised first so
// /auth/%69nternal, /auth//internal, /x/../auth/internal or /AUTH/Internal
// can't slip past.
function isInternalPath(rawPath) {
  let p = rawPath;
  try {
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(p); i++) p = decodeURIComponent(p);
  } catch {
    return true;   // malformed escapes: refuse rather than guess
  }
  p = path.posix.normalize(p.replace(/\\/g, '/')).toLowerCase();
  return /^\/+[^/]+\/internal(\/|;|$)/.test(p);
}

app.use((req, res, next) => {
  if (isInternalPath(req.path)) return res.status(404).json({ error: 'Not found' });
  // Only services talk to each other with this header; a client must never set it.
  delete req.headers['x-internal-token'];
  next();
});

const AUTH_SERVICE_URL       = process.env.AUTH_SERVICE_URL       || 'http://auth-service:4000';
const RETAIL_SERVICE_URL     = process.env.RETAIL_SERVICE_URL     || 'http://retail-service:4001';
const EMPLOYEE_SERVICE_URL   = process.env.EMPLOYEE_SERVICE_URL   || 'http://employee-service:4002';
const RESTAURANT_SERVICE_URL = process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4003';
const CHECKLIST_SERVICE_URL = process.env.CHECKLIST_SERVICE_URL || 'http://checklist-service:3006';
const ADMIN_SERVICE_URL     = process.env.ADMIN_SERVICE_URL     || 'http://admin-service:3007';
const FILE_SERVICE_URL      = process.env.FILE_SERVICE_URL      || 'http://file-service:4007';

const proxyError = (serviceName) => (err, req, res) => {
  console.error(`[${serviceName}] proxy error:`, err.message);
  res.status(502).json({ error: `${serviceName} unavailable` });
};

app.use('/auth', createProxyMiddleware({
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('auth-service') }
}));

app.use('/retail', createProxyMiddleware({
  target: RETAIL_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('retail-service') }
}));

app.use('/checklist', createProxyMiddleware({
  target: CHECKLIST_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('checklist-service') }
}));

app.use('/employee', createProxyMiddleware({
  target: EMPLOYEE_SERVICE_URL,
  changeOrigin: true,
  secure: false,
  autoRewrite: true,
  encodePathChars: false,
  on: { error: proxyError('employee-service') }
}));

app.use('/restaurant', createProxyMiddleware({
  target: RESTAURANT_SERVICE_URL,
  changeOrigin: true,
  secure: false,
  autoRewrite: true,
  encodePathChars: false,
  on: { error: proxyError('restaurant-service') }
}));

// Admin console (zodu_admin_panel_frontend) — same proxy pattern as every
// other service above. admin-service is still not reachable on its own
// public port; the gateway is the only door into it now.
app.use('/admin', createProxyMiddleware({
  target: ADMIN_SERVICE_URL,
  changeOrigin: true,
  on: { error: proxyError('admin-service') }
}));

// Central file storage. xfwd passes the client IP on, so file-service's per-IP
// rate limits count real clients, not the gateway.
app.use('/files', createProxyMiddleware({
  target: FILE_SERVICE_URL,
  changeOrigin: true,
  xfwd: true,
  on: { error: proxyError('file-service') }
}));

app.get('/', (req, res) => {
  res.send('Welcome to the API Gateway!');
});

if (require.main === module) {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
}

module.exports = { app, isInternalPath };
