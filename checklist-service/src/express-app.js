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

app.use('/api/checklists', require('./api/checklist-controller'));

// GET /file/* — stream file from MinIO
app.get('/file/*', async (req, res) => {
  try {
    const minio   = require('./utils/minio');
    const fileKey = req.params[0];
    await minio.streamFile(fileKey, res);
  } catch (err) {
    if (err.code === 'NoSuchKey') return res.status(404).json({ success: false, error: 'File not found' });
    res.status(500).json({ success: false, error: 'Failed to retrieve file' });
  }
});

// DELETE /delete/file/:name — delete file directly from MinIO by name
app.delete('/delete/file/:name', async (req, res) => {
  try {
    const minio    = require('./utils/minio');
    const fileName = req.params.name;
    const result   = await minio.deleteFileByName(fileName);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

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
