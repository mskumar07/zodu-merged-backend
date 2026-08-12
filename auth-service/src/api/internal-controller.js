const express = require('express');
const router  = express.Router();
const repo    = require('../repository/business-repo');

// Internal routes — called by restaurant-service only, NOT exposed via gateway
// No JWT required. Protect at network/gateway level (not callable from internet).

// POST /internal/company  — create or upsert company
router.post('/company', async (req, res) => {
  try {
    console.log("Creating company with data:--------", req.body);
    const company = await repo.createCompany(req.body);
    return res.status(201).json({ success: true, data: company });
  } catch (err) {
    console.error('[internal] createCompany:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /internal/company/:zodu_id  — update company
router.put('/company/:zodu_id', async (req, res) => {
  try {
    const updated = await repo.updateCompany(req.params.zodu_id, req.body);
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error('[internal] updateCompany:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/company/:zodu_id  — fetch company with address + bank
router.get('/company/:zodu_id', async (req, res) => {
  try {
    const company = await repo.getCompany(req.params.zodu_id);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    return res.status(200).json({ success: true, data: company });
  } catch (err) {
    console.error('[internal] getCompany:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/branches/max/:zodu_id  — get max branch_id for ID generation
router.get('/branches/max/:zodu_id', async (req, res) => {
  try {
    const row = await repo.findMaxBranchId(req.params.zodu_id);
    return res.status(200).json({ success: true, max: row.max });
  } catch (err) {
    console.error('[internal] findMaxBranchId:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/branches/:zodu_id  — get all branches for a company
router.get('/branches/:zodu_id', async (req, res) => {
  try {
    const branches = await repo.getBranches(req.params.zodu_id);
    return res.status(200).json({ success: true, data: branches });
  } catch (err) {
    console.error('[internal] getBranches:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/branches/:zodu_id/:branch_id  — get single branch
router.get('/branches/:zodu_id/:branch_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const rows = await repo.getBranches(zodu_id, branch_id);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Branch not found' });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[internal] getBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /internal/branches/default  — create minimal default branch (called on signup)
router.post('/branches/default', async (req, res) => {
  try {
    const { zodu_id, branch_id, branch_name, branch_mobile_no, branch_mail_id, qr_code_id } = req.body;
    if (!zodu_id || !branch_id || !branch_name) {
      return res.status(400).json({ success: false, message: 'zodu_id, branch_id and branch_name are required' });
    }
    const branch = await repo.createDefaultBranch({ zodu_id, branch_id, branch_name, branch_mobile_no, branch_mail_id, qr_code_id });
    return res.status(201).json({ success: true, data: branch });
  } catch (err) {
    console.error('[internal] createDefaultBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /internal/branches  — create full branch with address + bank
router.post('/branches', async (req, res) => {
  try {
    const branch = await repo.createBranch(req.body);
    return res.status(201).json({ success: true, data: branch });
  } catch (err) {
    console.error('[internal] createBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /internal/branches/:zodu_id/:branch_id  — update branch
router.put('/branches/:zodu_id/:branch_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const updated = await repo.updateBranch(zodu_id, branch_id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Branch not found' });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error('[internal] updateBranch:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /internal/invoice-settings/:zodu_id/:branch_id
router.get('/invoice-settings/:zodu_id/:branch_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const settings = await repo.getInvoiceSettings(zodu_id, branch_id);
    if (!settings) return res.status(404).json({ success: false, message: 'Invoice settings not found' });
    return res.status(200).json({ success: true, data: settings });
  } catch (err) {
    console.error('[internal] getInvoiceSettings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /internal/invoice-settings/:zodu_id/:branch_id  — upsert
router.put('/invoice-settings/:zodu_id/:branch_id', async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const settings = await repo.upsertInvoiceSettings(zodu_id, branch_id, req.body);
    return res.status(200).json({ success: true, data: settings });
  } catch (err) {
    console.error('[internal] upsertInvoiceSettings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
