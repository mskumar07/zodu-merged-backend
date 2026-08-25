const express = require('express');
const cors  = require('cors');
const conn = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const resRouter = require('./api/restaurant-controller');

const app = express();

app.use(express.json());
app.use(cors());
app.use(httpLogger);

app.use('/', resRouter);
app.use('/internal', require('./api/internal-controller'));
app.use('/api/dashboard', require('./api/dashboard-controller'));
app.use('/api/branch', require('./api/branch-controller'));
app.use('/api/menu', require('./api/menu-controller'));
app.use('/api/purchase', require('./api/purchase-controller'));
app.use('/api/vendor', require('./api/vendor-controller'));
app.use('/api/sale-returns', require('./api/saleReturn-controller'));
app.use('/api/report',      require('./api/report-controller'));
app.use('/api/expense',     require('./api/expense-controller'));
app.use('/api/hold',        require('./api/hold_item_controller'));
app.use('/api/inventory',   require('./api/inventory-controller'));
app.use('/api/orders',      require('./api/orders-controller'));

app.use(HandleErrorWithLogger);



// ✅ SAFE DB CHECK
(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Restaurant DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Restaurant DB connection failed:', err.message);
  }
})();


module.exports = app;
