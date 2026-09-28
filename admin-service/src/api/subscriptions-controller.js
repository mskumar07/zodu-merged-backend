const express = require('express');
const router = express.Router();
const { authService } = require('../clients');
const { requireAdminAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/subscriptions?page=&limit=&status=
router.get('/subscriptions', requireAdminAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const result = await authService.getSubscriptions({ page, limit, status });
  res.status(200).json({ success: true, ...result });
}));

// PUT /api/subscriptions/:zoduId/:branchId — override/extend a subscription.
// Restricted to super_admin: this writes into auth-service's business data
// via its own API, so it goes through auth-service's own validation/side
// effects rather than the admin panel touching the row directly.
router.put(
  '/subscriptions/:zoduId/:branchId',
  requireAdminAuth,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { zoduId, branchId } = req.params;
    const updated = await authService.updateSubscription(zoduId, branchId, req.body);
    res.status(200).json({ success: true, data: updated });
  })
);

module.exports = router;
