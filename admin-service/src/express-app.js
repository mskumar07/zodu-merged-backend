const express = require('express');
const cors = require('cors');
const { applySecurity, createRateLimit } = require('@zodu/security');
const conn = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const { CORS_ORIGIN, APP_SECRET } = require('./config');

if (!APP_SECRET || APP_SECRET.length < 32) {
  logger.error('APP_SECRET should be at least 32 random characters (openssl rand -hex 32): admin tokens are only as strong as it');
}

const app = express();

// Headers, request id, body limits. CORS: the admin console's origin only
// (CORS_ORIGIN, set per environment); per-IP limits are the gateway's.
applySecurity(app, { express, cors: false, ipLimitPerMinute: 0, bodyLimit: '100kb' });
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
// Password guessing: 10 sign-in attempts a minute per address.
app.use('/api/auth/login', createRateLimit({ name: 'admin-login', limit: 10 }));
app.use(httpLogger);

app.get('/health', (req, res) => res.status(200).json({ success: true, status: 'ok' }));

app.use('/api', require('./api/admin-auth-controller'));
app.use('/api', require('./api/admin-user-controller'));
app.use('/api', require('./api/dashboard-controller'));
app.use('/api', require('./api/companies-controller'));
app.use('/api', require('./api/subscriptions-controller'));

app.use(HandleErrorWithLogger);

(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Database connected');
    client.release();
  } catch (err) {
    logger.error('❌ Database connection failed: ' + err.message);
  }
})();

module.exports = app;
