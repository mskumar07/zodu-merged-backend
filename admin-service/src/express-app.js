const express = require('express');
const cors = require('cors');
const conn = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const { CORS_ORIGIN } = require('./config');

const app = express();

app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
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
