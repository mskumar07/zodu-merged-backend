const express = require('express');
const { requireInternal, applySecurity } = require('@zodu/security');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const security = require('./security');

const app = express({ strict: false });

// Headers, request id, trusted proxies, body limits. CORS is the gateway's;
// per-IP limits too.
applySecurity(app, { express, cors: false, ipLimitPerMinute: 0, bodyLimit: '1mb' });
app.use(httpLogger);
app.set('router options', { strict: false });

// Service-to-service routes: auth-service only (its X-Internal-Token).
app.use('/internal',        requireInternal('auth'), require('./api/internal-controller'));

// Customer routes: access token, company/branch from the token, route permissions.
app.use(security.middleware);
// Stored file ids → fresh URLs in every JSON response (document file_url, profile_photo_url).
app.use(require('./utils/file-client').fileUrlsMiddleware);

app.use('/api/employees',   require('./api/employee-controller'));
app.use('/api/attendance',  require('./api/attendance-controller'));

app.use(HandleErrorWithLogger);

// ── DB check ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') (async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Employee DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Employee DB connection failed:', err.message);
  }
})();

module.exports = app;
