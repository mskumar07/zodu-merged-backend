// employee-service /internal routes (caller name checklist_v2, INTERNAL_TOKEN).
//   GET /internal/employee/by-user       user → employee in a branch
//   GET /internal/employees/directory    the branch's employees, paged (directory sync)
const { internalHeaders } = require('@zodu/security');
const { EMPLOYEE_SERVICE_URL } = require('../config');
const { unavailable } = require('../utils/errors');

const base = () => String(EMPLOYEE_SERVICE_URL).replace(/\/+$/, '');

async function get(path, { timeoutMs = 5000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${base()}${path}`, { headers: internalHeaders(), signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return { status: 404, body: null };
      if (res.ok) return { status: res.status, body: await res.json() };
      lastErr = new Error(`employee-service ${res.status}`);
      if (res.status < 500) break;   // 4xx: retrying won't help
    } catch (err) {
      lastErr = err;
    }
  }
  const e = unavailable('Employee service unavailable, try again', 'DIRECTORY_UNAVAILABLE');
  e.cause = lastErr;
  throw e;
}

// → employee_id or null
async function byUser({ userId, zoduId, branchId }) {
  const q = new URLSearchParams({ user_id: userId, zodu_id: zoduId, branch_id: branchId ?? '' });
  const { status, body } = await get(`/internal/employee/by-user?${q}`, { timeoutMs: 3000 });
  if (status === 404) return null;
  return body?.data?.employee_id ?? null;
}

// One page → { data: [{ employee_id, user_id, employee_name, employee_code, reporting_manager_id, is_active, updated_at }], next_cursor }
async function directoryPage({ zoduId, branchId, updatedSince, cursor, limit = 500, timeoutMs }) {
  const q = new URLSearchParams({
    zodu_id: zoduId, branch_id: branchId, limit: String(limit),
    ...(updatedSince && { updated_since: updatedSince }),
    ...(cursor && { cursor }),
  });
  const { status, body } = await get(`/internal/employees/directory?${q}`, { timeoutMs });
  if (status === 404) return { data: [], next_cursor: null };
  return { data: body?.data ?? [], next_cursor: body?.next_cursor ?? null };
}

module.exports = { byUser, directoryPage };
