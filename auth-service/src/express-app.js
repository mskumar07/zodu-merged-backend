const express = require('express');
const { applySecurity, requireInternal } = require('@zodu/security');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const { auth } = require('./auth');
const authRouter = require('./api/auth-controller');
const roleRouter = require('./api/role-controller');

const app = express();

// Headers, request id, body limits. No CORS here: the gateway answers CORS for
// every service (a second Access-Control-Allow-Origin would break the web
// refresh cookie). No per-IP limit here either: the gateway has it, and the
// token endpoints have their own (auth-controller).
// Behind the gateway (and the HTTPS proxy in front of it), so req.ip is the
// first address from the right that isn't a private hop.
applySecurity(app, {
  express,
  cors: false,
  ipLimitPerMinute: 0,
  trustProxy: process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
});
app.use(httpLogger);

// Public keys for the access tokens (gateway: /auth/.well-known/jwks.json).
// The other services fetch them over the internal network.
app.get('/.well-known/jwks.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(auth().keys.jwks);
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Service-to-service routes (here and /internal/employee/* in role-controller):
// a known service token first; each route then names the services it accepts.
app.use('/internal', requireInternal());

app.use('/', authRouter);
app.use('/', roleRouter);
app.use('/internal', require('./api/internal-controller'));

app.use(HandleErrorWithLogger);

// ✅ SAFE DB CHECK (connect + release)
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      const client = await conn.connect();
      logger.info('✅ Database connected');
      client.release();
    } catch (err) {
      logger.error('❌ Database connection failed:', err.message);
    }
  })();
}

module.exports = app;
