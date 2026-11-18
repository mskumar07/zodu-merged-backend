// The checked company / branch and the caller, for handlers behind the security
// middleware. Company and branch come from the token (req.tenant), never the body.
const { OWNER_ROLE } = require('@zodu/security');
const pool = require('../database/pool');
const employees = require('../clients/employee');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tenantOf = (req) => ({ zodu_id: req.tenant.zoduId, branch_id: req.tenant.branchId });

function callerOf(req) {
  const isOwner = req.auth.role === OWNER_ROLE;
  const can = (perm) => isOwner || req.auth.perms.includes(perm);
  return { userId: req.auth.userId, isOwner, can };
}

// The caller's employee_id in this branch: the local directory first (no network),
// then employee-service, cached 60s. null when the user has no employee record here.
const cache = new Map();
async function myEmployeeId(req) {
  if (req.myEmployeeId !== undefined) return req.myEmployeeId;
  const { zodu_id, branch_id } = tenantOf(req);
  const userId = req.auth.userId;
  const { rows: [local] } = await pool.query(
    `SELECT employee_id FROM ckl.employee_directory
      WHERE user_id = $1 AND zodu_id = $2 AND branch_id = $3 AND is_active
      LIMIT 1`,
    [userId, zodu_id, branch_id],
  );
  if (local) {
    req.myEmployeeId = local.employee_id;
    return local.employee_id;
  }
  const key = `${userId}|${zodu_id}|${branch_id}`;
  const hit = cache.get(key);
  let value;
  if (hit && hit.expires > Date.now()) {
    value = hit.value;
  } else {
    const found = await employees.byUser({ userId, zoduId: zodu_id, branchId: branch_id });
    value = found && UUID.test(String(found)) ? String(found) : null;
    if (cache.size > 10_000) cache.clear();
    cache.set(key, { value, expires: Date.now() + 60_000 });
  }
  req.myEmployeeId = value;
  return value;
}

module.exports = { tenantOf, callerOf, myEmployeeId, UUID };
