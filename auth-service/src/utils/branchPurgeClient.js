const axios = require('axios');
const {
  RETAIL_SERVICE_URL,
  RESTAURANT_SERVICE_URL,
  EMPLOYEE_SERVICE_URL,
  PAYROLL_SERVICE_URL,
  CHECKLIST_SERVICE_URL,
} = require('../config');

// Order matters: auth-service purges tbl_branch itself LAST (see
// business-repo.js's purgeBranch), after every one of these has succeeded —
// so a partial failure never leaves tbl_branch gone while other services
// still hold data for it. Stop on first failure; the caller reports which
// service failed so a retry can re-run the whole sequence (every fn_purge_branch
// call is idempotent — already-purged rows just delete 0 rows, no error).
const SERVICES = [
  { name: 'retail-service',     baseURL: RETAIL_SERVICE_URL },
  { name: 'restaurant-service', baseURL: RESTAURANT_SERVICE_URL },
  { name: 'employee-service',   baseURL: EMPLOYEE_SERVICE_URL },
  { name: 'payroll-service',    baseURL: PAYROLL_SERVICE_URL },
  { name: 'checklist-service',  baseURL: CHECKLIST_SERVICE_URL },
];

// Calls POST /internal/branches/:zodu_id/:branch_id/purge on every service in
// SERVICES, in order, stopping at the first failure. Returns
// { success, results: [{service, data}], failedService, error } —
// failedService/error are only set when success is false.
exports.purgeBranchAcrossServices = async (zodu_id, branch_id) => {
  const results = [];

  for (const svc of SERVICES) {
    try {
      const res = await axios.post(
        `${svc.baseURL}/internal/branches/${zodu_id}/${branch_id}/purge`,
        {},
        { timeout: 30000 }
      );
      results.push({ service: svc.name, data: res.data?.data });
    } catch (err) {
      const message = err.response?.data?.message || err.response?.data?.error || err.message;
      return { success: false, results, failedService: svc.name, error: message };
    }
  }

  return { success: true, results };
};
