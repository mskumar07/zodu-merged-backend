const express = require('express');
const router  = express.Router();
const minio   = require('../utils/minio');
const { logger } = require('../utils');

// GET /file/:name — serves invoice signature and company logo images out of MinIO.
// Public on purpose: the invoice template (and any print/PDF renderer) loads
// this URL as a plain <img src>, with no Authorization header to send. The key
// carries a timestamp, so it is unguessable enough for these images.
router.get('/:name', async (req, res) => {
  const fileName = req.params.name;
  if (!fileName) return res.status(400).json({ success: false, error: 'File name required' });

  try {
    await minio.streamFile(fileName, res);
  } catch (err) {
    // Only a genuinely absent object is a 404. Everything else — missing MinIO
    // credentials, an unreachable endpoint, the wrong bucket — is a server-side
    // fault, and reporting those as "File not found" sends people hunting for a
    // file that is sitting in the bucket the whole time.
    if (res.headersSent) return res.destroy();

    const missing = err.code === 'NoSuchKey' || err.code === 'NotFound';
    logger.error(`GET /file/${fileName} failed: ${err.code || 'ERR'} — ${err.message}`);

    return missing
      ? res.status(404).json({ success: false, error: 'File not found' })
      : res.status(500).json({
          success: false,
          error: 'File could not be served',
          code: err.code || null,
        });
  }
});

module.exports = router;
