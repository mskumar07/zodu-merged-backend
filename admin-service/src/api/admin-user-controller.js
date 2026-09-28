const express = require('express');
const router = express.Router();
const service = require('../services/admin-user-service');
const RequestValidator = require('../utils/requestValidator');
const schema = require('../schema/admin-user-schema');
const STATUS_CODES = require('../utils/error/status-codes');
const { requireAdminAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// Only a super_admin can create/list console operators — this issues login
// credentials for the admin panel itself, not a customer-facing resource.
router.use('/admin-users', requireAdminAuth, requireRole('super_admin'));

// GET /api/admin-users
router.get('/admin-users', asyncHandler(async (req, res) => {
  const users = await service.list();
  res.status(STATUS_CODES.OK).json({ success: true, data: users });
}));

// POST /api/admin-users
router.post('/admin-users', asyncHandler(async (req, res) => {
  const { errors, input } = await RequestValidator(schema.create_admin_user, req.body);
  if (errors) return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, error: errors });

  const user = await service.create(input);
  res.status(STATUS_CODES.CREATED).json({ success: true, data: user });
}));

module.exports = router;
