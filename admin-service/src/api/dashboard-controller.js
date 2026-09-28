const express = require('express');
const router = express.Router();
const service = require('../services/dashboard-service');
const { requireAdminAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/dashboard/summary
router.get('/dashboard/summary', requireAdminAuth, asyncHandler(async (req, res) => {
  const summary = await service.getSummary();
  res.status(200).json({ success: true, data: summary });
}));

module.exports = router;
