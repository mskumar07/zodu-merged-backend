const express = require('express');
const router  = express.Router();
const minio   = require('../utils/minio');

// GET /file/:name  — same pattern as restaurant-service
router.get('/:name', async (req, res) => {
  try {
    const fileName = req.params.name;
    if (!fileName) return res.status(400).json({ success: false, error: 'File name required' });
    await minio.streamFile(fileName, res);
  } catch (err) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
});

module.exports = router;
