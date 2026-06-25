const express = require('express');
const cors    = require('cors');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(httpLogger);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payroll-service' }));

app.use('/', require('./api/salary-controller'));

// ── DB check ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Payroll DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Payroll DB connection failed:', err.message);
  }
})();

module.exports = app;
