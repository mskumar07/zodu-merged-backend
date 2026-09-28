const { createServiceClient } = require('./baseServiceClient');
const { SERVICES } = require('../config');

const http = createServiceClient('retail', SERVICES.retail);

// Requires retail-service to expose admin-only summary endpoints — see
// docs/SERVICE_INTEGRATION.md §2. Falls back gracefully (caller catches and
// zero-fills) so the dashboard still renders if one service is down.
module.exports = {
  getInvoiceStats: (params) =>
    http.get('/internal/admin/invoices/stats', { params }).then((r) => r.data.data),

  getPurchaseStats: (params) =>
    http.get('/internal/admin/purchases/stats', { params }).then((r) => r.data.data),

  getExpenseStats: (params) =>
    http.get('/internal/admin/expenses/stats', { params }).then((r) => r.data.data),

  getCompanyWiseStats: (params) =>
    http.get('/internal/admin/companies/stats', { params }).then((r) => r.data.data),

  // Stats for an exact list of zodu_ids, zero-filled for any with no
  // activity — used to build the full, paginated Companies page (as
  // opposed to getCompanyWiseStats' "top N with activity" dashboard card).
  getStatsForCompanies: (zoduIds) =>
    http.post('/internal/admin/companies/stats-for', { zodu_ids: zoduIds }).then((r) => r.data.data),
};
