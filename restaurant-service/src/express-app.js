const express = require('express');
const cors  = require('cors');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const resRouter = require('./api/restaurant-controller');

const app = express();

app.use(express.json());
app.use(cors());
app.use(httpLogger);

app.use('/', resRouter);
app.use('/api/dashboard', require('./api/dashboard-controller'));

app.use(HandleErrorWithLogger);



// ✅ SAFE DB CHECK (connect + release)
(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Database connected');
    client.release();
  } catch (err) {
    logger.error('❌ Database connection failed:', err.message);
  }
})();


module.exports = app;