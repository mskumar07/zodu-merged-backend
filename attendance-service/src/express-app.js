const express = require('express');
const { applySecurity } = require('@zodu/security');
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

// Customer routes: access token, company/branch from the token, route permissions.
app.use(security.middleware);

// Employee records, documents, emergency contacts and faces are employee-service's (/employee/api/employees).
app.use('/api/attendance',  require('./api/attendance-controller'));
app.use('/api/leave',       require('./api/leave-controller'));
app.use('/api/leave-types', require('./api/leave-type-controller'));
app.use('/api/leave-policies', require('./api/leave-policy-controller'));
app.use('/api/shift-templates', require('./api/shift-template-controller'));
app.use('/api/holidays',    require('./api/holiday-controller'));

app.use(HandleErrorWithLogger);

// ── DB check ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') (async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Attendance DB connected');
    client.release();
  } catch (err) {
    // pino: the error object goes first; arguments after the message are dropped.
    logger.error({ err, code: err.code }, '❌ Attendance DB connection failed: %s', err.message);
  }
})();

module.exports = app;
