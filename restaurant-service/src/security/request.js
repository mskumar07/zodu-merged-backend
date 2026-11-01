// The checked company / branch, for handlers behind the security middleware.

// zodu_id / branch_id as the services name them.
const tenantOf = (req) => ({ zodu_id: req.tenant.zoduId, branch_id: req.tenant.branchId });

module.exports = { tenantOf };
