const express = require('express');
const cors  = require('cors');
const { requireInternal } = require('@zodu/security');
const conn  = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const resRouter = require('./api/retail-controller');

const app = express();

app.use(express.json());
app.use(cors());
app.use(httpLogger);
// Service-to-service routes: a known service token first; each route in
// internal-controller.js then names the services it accepts.
app.use('/internal', requireInternal());
// Stored file refs (expense / purchase / payment attachments) → fresh URLs in every JSON response.
app.use(require('./utils/file-client').fileUrlsMiddleware);


app.use('/api/retail', (req, res) => {
  res.send('Retail service is up and running!');
})

app.use('/', resRouter);
app.use('/internal', require('./api/internal-controller'));
app.use('/api/dashboard', require('./api/dashboard-controller'));
app.use('/api/branch', require('./api/branch-controller'));
app.use('/api/menu', require('./api/menu-controller'));
app.use('/api/purchase', require('./api/purchase-controller'));
app.use('/api/vendor', require('./api/vendor-controller'));
app.use('/api/sale-returns', require('./api/saleReturn-controller'));
app.use('/api/purchase-returns', require('./api/purchaseReturn-controller'));
app.use('/api/report',      require('./api/report-controller'));
app.use('/api/accounting',  require('./api/accounting-controller'));
app.use('/api/expense',     require('./api/expense-controller'));
app.use('/api/gst-state-code', require('./api/gstStateCode-controller'));

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
