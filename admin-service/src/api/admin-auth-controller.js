const express = require('express');
const router = express.Router();
const service = require('../services/admin-auth-service');
const { requireAdminAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/login
router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await service.login(email, password);
  res.status(200).json({ success: true, data: result });
}));

// GET /api/auth/me
router.get('/auth/me', requireAdminAuth, asyncHandler(async (req, res) => {
  const profile = await service.getProfile(req.admin.id);
  res.status(200).json({ success: true, data: profile });
}));

module.exports = router;
