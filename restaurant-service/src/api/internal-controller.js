const express = require('express');
const router  = express.Router();
const { requireInternal } = require('@zodu/security');
const fromAuth  = requireInternal('auth');
const repository = require('../repository/restaurant-repo');

// Internal routes: blocked at the gateway, and every call needs the calling
// service's X-Internal-Token (express-app.js).
//   seed-defaults, purge   auth-service

// POST /internal/seed-defaults — seed default units + GST rates for a new branch
router.post('/seed-defaults', fromAuth, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.body;
    if (!zodu_id || !branch_id) {
      return res.status(400).json({ success: false, message: 'zodu_id and branch_id are required' });
    }
    await repository.seedDefaultsForBranch(zodu_id, branch_id);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[internal] seedDefaultsForBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /internal/branches/:zodu_id/:branch_id/purge — hard-delete every row
// scoped to this branch. Called by auth-service's delete-branch orchestrator.
router.post('/branches/:zodu_id/:branch_id/purge', fromAuth, async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const results = await repository.purgeBranch(zodu_id, branch_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /internal/companies/:zodu_id/purge — hard-delete every row scoped to
// this company, all branches. Called by auth-service's delete-company orchestrator.
router.post('/companies/:zodu_id/purge', fromAuth, async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const results = await repository.purgeCompany(zodu_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeCompany:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
