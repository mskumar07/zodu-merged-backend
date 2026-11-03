const express = require('express');
const { requireInternal, applySecurity } = require('@zodu/security');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const security = require('./security');

const app = express();

// Headers, request id, trusted proxies, body limits. CORS is the gateway's;
// per-IP limits too.
applySecurity(app, { express, cors: false, ipLimitPerMinute: 0, bodyLimit: '1mb' });
app.use(httpLogger);

// Service-to-service routes: a known service token first; each route in
// internal-controller.js then names the services it accepts.
app.use('/internal', requireInternal(), require('./api/internal-controller'));

// Customer routes: access token, company/branch from the token, route permissions.
app.use(security.middleware);
// Stored file refs (expense / purchase / payment attachments) → fresh URLs in every JSON response.
app.use(require('./utils/file-client').fileUrlsMiddleware);

app.use('/', require('./api/retail-controller'));
app.use('/api/dashboard', require('./api/dashboard-controller'));
app.use('/api/branch', require('./api/branch-controller'));
app.use('/api/menu', require('./api/menu-controller'));
app.use('/api/purchase', require('./api/purchase-controller'));
app.use('/api/vendor', require('./api/vendor-controller'));
app.use('/api/sale-returns', require('./api/saleReturn-controller'));
app.use('/api/purchase-returns', require('./api/purchaseReturn-controller'));
app.use('/api/report',      require('./api/report-controller'));
app.use('/api/accounting',  require('./api/accounting-controller'));
app.use('/api/expense',     require('./api/expense-controller'));
app.use('/api/gst-state-code', require('./api/gstStateCode-controller'));

app.use(HandleErrorWithLogger);

// ── DB check ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') (async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Database connected');
    client.release();
  } catch (err) {
    logger.error('❌ Database connection failed:', err.message);
  }
})();

module.exports = app;
