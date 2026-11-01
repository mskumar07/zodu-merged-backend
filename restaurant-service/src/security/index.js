// The service's customer-route security, built once (src/express-app.js).
const { createServiceSecurity } = require('@zodu/security');
const { logger } = require('../utils/logger');
const rules = require('./rules');
const { AUTH_SERVICE_URL } = require('../config');

module.exports = createServiceSecurity({
  rules,
  logger,
  authServiceUrl: AUTH_SERVICE_URL,
  // The routes here answer errors as { success: false, message }.
  respond: (req, res, status, message) => res.status(status).json({ success: false, message }),
});
