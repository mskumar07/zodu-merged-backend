// The checked company / branch and the caller, for handlers behind the security middleware.
const { OWNER_ROLE } = require('@zodu/security');

// zodu_id / branch_id as the handlers and schemas name them.
const tenantOf = (req) => ({ zodu_id: req.tenant.zoduId, branch_id: req.tenant.branchId });

function callerOf(req) {
  const isOwner = req.auth.role === OWNER_ROLE;
  const can = (perm) => isOwner || req.auth.perms.includes(perm);
  return { userId: req.auth.userId, isOwner, can, canAssignRoles: can('role:edit') };
}

module.exports = { tenantOf, callerOf };
