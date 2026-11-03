const express = require('express');
const { requireInternal, applySecurity } = require('@zodu/security');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');

const app = express();

// Headers, request id, trusted proxies, body limits. Not reachable through the gateway.
applySecurity(app, { express, cors: false, ipLimitPerMinute: 0 });
app.use(httpLogger);
// Service-to-service routes (salary-controller.js): a known service token
// first; each route then names the services it accepts.
app.use('/internal', requireInternal());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payroll-service' }));

app.use('/', require('./api/salary-controller'));
// Anything else (there are no customer routes): 404.
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ── DB check ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') (async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Payroll DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Payroll DB connection failed:', err.message);
  }
})();

module.exports = app;
