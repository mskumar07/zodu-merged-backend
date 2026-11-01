// The checked company / branch and the caller, for handlers behind the security middleware.
const { OWNER_ROLE, internalHeaders } = require('@zodu/security');
const { EMPLOYEE_SERVICE_URL } = require('../config');

// zodu_id / branch_id as the handlers and schemas name them.
const tenantOf = (req) => ({ zodu_id: req.tenant.zoduId, branch_id: req.tenant.branchId });

function callerOf(req) {
  const isOwner = req.auth.role === OWNER_ROLE;
  const can = (perm) => isOwner || req.auth.perms.includes(perm);
  return { userId: req.auth.userId, isOwner, can };
}

// The caller's own employee_id in the request's company / branch (employee-service), cached 60s.
const cache = new Map();
async function ownEmployeeId(req) {
  const { zodu_id, branch_id } = tenantOf(req);
  const key = `${req.auth.userId}|${zodu_id}|${branch_id}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = null;
  const q = new URLSearchParams({ user_id: req.auth.userId, zodu_id, branch_id: branch_id ?? '' });
  let res;
  try {
    res = await fetch(`${EMPLOYEE_SERVICE_URL}/internal/employee/by-user?${q}`, {
      headers: internalHeaders(), signal: AbortSignal.timeout(3000),
    });
  } catch {
    res = null;
  }
  if (!res || (!res.ok && res.status !== 404)) throw Object.assign(new Error('Employee lookup unavailable'), { status: 503 });
  if (res.ok) value = (await res.json())?.data?.employee_id ?? null;
  if (cache.size > 10_000) cache.clear();
  cache.set(key, { value, expires: Date.now() + 60_000 });
  return value;
}

// employee_id must be the caller's own unless they hold `perm`.
async function mayActFor(req, employeeId, perm) {
  if (callerOf(req).can(perm)) return true;
  const own = await ownEmployeeId(req);
  return Boolean(own) && own === employeeId;
}

module.exports = { tenantOf, callerOf, ownEmployeeId, mayActFor };
