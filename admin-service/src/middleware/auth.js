const jwt = require('jsonwebtoken');
const { APP_SECRET } = require('../config');
const { AuthorizeError, ForbiddenError } = require('../utils/error');

// Verifies the admin console's own JWT — issued by admin-auth-service on
// login, never the customer-facing token from auth-service. Keeping these
// two token spaces separate means an admin session can't be forged from a
// leaked customer token and vice versa.
const requireAdminAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AuthorizeError('Missing bearer token');

    const payload = jwt.verify(token, APP_SECRET);
    req.admin = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    next(AuthorizeError('Invalid or expired session'));
  }
};

// Usage: requireRole('super_admin', 'finance')
const requireRole = (...roles) => (req, res, next) => {
  if (!req.admin || !roles.includes(req.admin.role)) {
    return next(ForbiddenError('You do not have permission to perform this action'));
  }
  next();
};

module.exports = { requireAdminAuth, requireRole };
