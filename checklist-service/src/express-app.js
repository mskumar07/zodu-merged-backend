const express = require('express');
const cors  = require('cors');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const resRouter = require('./routes/index');

const app = express();

app.use(express.json());
app.use(cors());
app.use(httpLogger);

app.use('/', resRouter);

app.use(HandleErrorWithLogger);



conn.connect()
.then(res => {
    logger.info('Database Connected at');
  })
  .catch(err => {
    logger.error('Connection error:', err.stack);
  });


module.exports = app;