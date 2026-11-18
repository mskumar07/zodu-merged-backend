// The service's customer-route security, built once (src/express-app.js).
const { createServiceSecurity } = require('@zodu/security');
const { logger } = require('../utils/logger');
const rules = require('./rules');
const { AUTH_SERVICE_URL } = require('../config');

module.exports = createServiceSecurity({
  rules,
  logger,
  authServiceUrl: AUTH_SERVICE_URL,
  // The service's error body: { success: false, error }.
  respond: (req, res, status, message) => res.status(status).json({ success: false, error: message }),
});
