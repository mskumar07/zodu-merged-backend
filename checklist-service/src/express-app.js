const express = require('express');
const { requireInternal, applySecurity } = require('@zodu/security');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const security = require('./security');

const app = express();

// Headers, request id, trusted proxies, body limits. CORS and per-IP limits: the gateway.
applySecurity(app, { express, cors: false, ipLimitPerMinute: 0, bodyLimit: '1mb' });
app.use(httpLogger);

// Service-to-service routes: auth-service only (its X-Internal-Token).
app.use('/internal', requireInternal('auth'), require('./api/internal-controller'));

// Customer routes: access token, company/branch from the token, route permissions.
app.use(security.middleware);
// Stored file refs → fresh URLs in every JSON response (attachment file_url).
app.use(require('./utils/file-client').fileUrlsMiddleware);

app.use('/api/checklists', require('./api/checklist-controller'));

// Files are served by file-service: old /checklist/file/* URLs through the
// gateway's legacy route, new ones as file-service URLs. Attachments are
// removed with DELETE /api/checklists/:id/attachments/:file_id.

app.use(HandleErrorWithLogger);

// DB connectivity check on startup
if (process.env.NODE_ENV !== 'test') (async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Checklist DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Checklist DB connection failed:', err.message);
  }
})();

module.exports = app;
