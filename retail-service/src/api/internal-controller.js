const express = require('express');
const router  = express.Router();
const repository = require('../repository/retail-repo');
const adminRepo = require('../repository/admin-repo');

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

// POST /internal/companies/:zodu_id/purge — hard-delete every row scoped to
// this company, all branches. Called by auth-service's delete-company orchestrator.
router.post('/companies/:zodu_id/purge', async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const results = await repository.purgeCompany(zodu_id);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[internal] purgeCompany:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── ADMIN CONSOLE ────────────────────────────────────────────────────────────
// Called by admin-service only (zodu_admin_panel), same trust boundary as
// the rest of this file — not exposed via gateway. Cross-tenant, unlike
// every other route here — see repository/admin-repo.js.

// GET /internal/admin/invoices/stats -> { total, changePct }
router.get('/admin/invoices/stats', async (req, res) => {
  try {
    const stats = await adminRepo.getInvoiceStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('[internal] getInvoiceStats:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/admin/purchases/stats -> { total, changePct }
router.get('/admin/purchases/stats', async (req, res) => {
  try {
    const stats = await adminRepo.getPurchaseStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('[internal] getPurchaseStats:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/admin/expenses/stats -> { total, changePct }
router.get('/admin/expenses/stats', async (req, res) => {
  try {
    const stats = await adminRepo.getExpenseStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('[internal] getExpenseStats:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/admin/companies/stats?limit= -> [{ zodu_id, invoice_count, purchase_count, expense_count }, ...]
// Top N companies WITH ACTIVITY, for the dashboard's snapshot card. For the
// full Companies page (every company, zero-activity included), see
// POST /admin/companies/stats-for below.
router.get('/admin/companies/stats', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const stats = await adminRepo.getCompanyWiseStats(limit);
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('[internal] getCompanyWiseStats:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /internal/admin/companies/stats-for  { zodu_ids: [...] }
// -> [{ zodu_id, invoice_count, purchase_count, expense_count }, ...], one
// row per id given, zero-filled for a company with no activity at all. Body
// (not query string) because admin-service calls this with one page's worth
// of ids from auth-service's company list — could exceed a URL's practical
// length as the page size grows.
router.post('/admin/companies/stats-for', async (req, res) => {
  try {
    const zoduIds = Array.isArray(req.body.zodu_ids) ? req.body.zodu_ids : [];
    if (!zoduIds.length) return res.status(200).json({ success: true, data: [] });
    if (zoduIds.length > 200) {
      return res.status(400).json({ success: false, message: 'zodu_ids: at most 200 per call' });
    }
    const stats = await adminRepo.getStatsForCompanies(zoduIds);
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error('[internal] getStatsForCompanies:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
