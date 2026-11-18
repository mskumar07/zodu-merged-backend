// The service's customer-route security, built once (src/api-app.js).
const { createServiceSecurity } = require('@zodu/security');
const { logger } = require('../utils/logger');
const rules = require('./rules');
const { AUTH_SERVICE_URL } = require('../config');

module.exports = createServiceSecurity({
  rules,
  logger,
  authServiceUrl: AUTH_SERVICE_URL,
  maxLimit: 500,
  respond: (req, res, status, message) => res.status(status).json({
    success: false,
    error: message,
    code: { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 503: 'DEPENDENCY_UNAVAILABLE' }[status] || 'ERROR',
  }),
});
