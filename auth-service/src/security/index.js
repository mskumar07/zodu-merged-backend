// The service's customer-route security, built once (src/express-app.js).
// auth-service issues the tokens, so it checks them with its own keys and reads
// branch access from its own tables instead of calling itself.
const { createServiceSecurity } = require('@zodu/security');
const { logger } = require('../utils');
const { auth } = require('../auth');
const authRepo = require('../repository/auth-repo');
const rules = require('./rules');

module.exports = createServiceSecurity({
  rules,
  logger,
  // The routes here answer errors as { message }.
  respond: (req, res, status, message) => res.status(status).json({ message }),
  // initAuth() loads the keys after the routers are built.
  verifier: { verify: (...args) => auth().verifier.verify(...args) },
  accessClient: {
    getAccess: ({ userId, zoduId, branchId }) =>
      authRepo.getUserBranchAccess({ user_id: userId, zodu_id: zoduId, branch_id: branchId || null }),
  },
});
