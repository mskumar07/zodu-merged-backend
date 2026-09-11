const express = require('express');
const router  = express.Router();
const repository = require('../repository/restaurant-repo');

// Internal routes — called by auth-service only, NOT exposed via gateway.
// No JWT required. Protect at network/gateway level (not callable from internet).

// POST /internal/seed-defaults — seed default units + GST rates for a new branch
router.post('/seed-defaults', async (req, res) => {
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
router.post('/branches/:zodu_id/:branch_id/purge', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const results = await repository.purgeBranch(zodu_id, branch_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
