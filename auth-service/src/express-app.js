const express = require('express');
const cors  = require('cors');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const authRouter = require('./api/auth-controller');
const roleRouter = require('./api/role-controller');

const app = express();

app.use(express.json());
app.use(cors());
app.use(httpLogger);

app.use('/', authRouter);
app.use('/', roleRouter);
app.use('/internal', require('./api/internal-controller'));

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