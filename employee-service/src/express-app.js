const express = require('express');
const cors    = require('cors');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');

const app = express({ strict: false });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(httpLogger);
app.set('router options', { strict: false });

app.use('/api/employees', require('./api/employee-controller'));
app.use('/file',          require('./api/file-controller'));
app.use('/internal',      require('./api/internal-controller'));

app.use(HandleErrorWithLogger);

// ── DB check ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Employee DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Employee DB connection failed:', err.message);
  }
})();

module.exports = app;
