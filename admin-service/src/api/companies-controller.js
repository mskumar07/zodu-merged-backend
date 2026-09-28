const express = require('express');
const router = express.Router();
const { authService, retailService } = require('../clients');
const { requireAdminAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/companies?page=&limit=&search=
router.get('/companies', requireAdminAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search = '' } = req.query;
  const result = await authService.listCompanies({ page, limit, search });
  res.status(200).json({ success: true, ...result });
}));

// GET /api/companies/stats?page=&limit=&search=
// The "Company / User-wise Statistics" table's real data source — EVERY
// company (paginated), invoice/purchase/expense counts included and
// zero-filled for one with no activity at all. auth-service's company list
// is the anchor (it's the only place that knows about a zero-activity
// company); retail-service is asked for stats on exactly that page's ids —
// see retail-service's POST /internal/admin/companies/stats-for.
router.get('/companies/stats', requireAdminAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search = '' } = req.query;
  const companiesPage = await authService.listCompanies({ page, limit, search });

  // retail-service being down zero-fills every row rather than 500ing the
  // whole page — the company list (from auth-service) is still useful on
  // its own, same graceful-degradation approach as the dashboard summary.
  const zoduIds = companiesPage.data.map((c) => c.zodu_id);
  let companyStats = [];
  try {
    companyStats = await retailService.getStatsForCompanies(zoduIds);
  } catch (err) {
    req.log?.warn({ err: err.message }, 'companies/stats: retail-service unavailable, zero-filling');
  }
  const statsById = new Map(companyStats.map((s) => [s.zodu_id, s]));

  const rows = companiesPage.data.map((company) => {
    const stats = statsById.get(company.zodu_id);
    return {
      zodu_id: company.zodu_id,
      business_name: company.business_name,
      mail_id: company.mail_id,
      mobile_no: company.mobile_no,
      invoiceCount: stats?.invoice_count ?? 0,
      purchaseCount: stats?.purchase_count ?? 0,
      expenseCount: stats?.expense_count ?? 0,
    };
  });

  res.status(200).json({
    success: true,
    data: rows,
    total: companiesPage.total,
    page: companiesPage.page,
    limit: companiesPage.limit,
  });
}));

// GET /api/companies/:zoduId
router.get('/companies/:zoduId', requireAdminAuth, asyncHandler(async (req, res) => {
  const [company, branches] = await Promise.all([
    authService.getCompany(req.params.zoduId),
    authService.getBranches(req.params.zoduId),
  ]);
  res.status(200).json({ success: true, data: { ...company, branches } });
}));

module.exports = router;
