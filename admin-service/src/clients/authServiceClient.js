const { createServiceClient } = require('./baseServiceClient');
const { SERVICES } = require('../config');

const http = createServiceClient('auth', SERVICES.auth);

// All calls hit auth-service's existing /internal routes
// (auth-service/src/api/internal-controller.js) — no new routes required
// there for read-only company/branch/subscription data.
module.exports = {
  getCompany: (zoduId) => http.get(`/internal/company/${zoduId}`).then((r) => r.data.data),

  getBranches: (zoduId) => http.get(`/internal/branches/${zoduId}`).then((r) => r.data.data),

  getBranch: (zoduId, branchId) =>
    http.get(`/internal/branches/${zoduId}/${branchId}`).then((r) => r.data.data),

  // Cross-company listing/search for the admin console. Requires
  // auth-service to expose these two admin-only endpoints — see
  // docs/SERVICE_INTEGRATION.md §1 for the controller stub to add there.
  listCompanies: (params) => http.get('/internal/admin/companies', { params }).then((r) => r.data),

  getSubscriptions: (params) =>
    http.get('/internal/admin/subscriptions', { params }).then((r) => r.data),

  updateSubscription: (zoduId, branchId, payload) =>
    http
      .put(`/internal/admin/subscriptions/${zoduId}/${branchId}`, payload)
      .then((r) => r.data.data),
};
