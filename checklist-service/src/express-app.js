const express = require('express');
const cors    = require('cors');
const conn    = require('./database/connection');
const { httpLogger, logger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(httpLogger);
// Stored file refs → fresh URLs in every JSON response (attachment file_url).
app.use(require('./utils/file-client').fileUrlsMiddleware);

app.use('/api/checklists', require('./api/checklist-controller'));
app.use('/internal', require('./api/internal-controller'));

// Files are served by file-service: old /checklist/file/* URLs through the
// gateway's legacy route, new ones as file-service URLs. Attachments are
// removed with DELETE /api/checklists/:id/attachments/:file_id.

app.use(HandleErrorWithLogger);

// DB connectivity check on startup
(async () => {
  try {
    const client = await conn.connect();
    logger.info('✅ Checklist DB connected');
    client.release();
  } catch (err) {
    logger.error('❌ Checklist DB connection failed:', err.message);
  }
})();

module.exports = app;
