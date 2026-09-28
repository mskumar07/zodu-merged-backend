const axios = require('axios');
const { INTERNAL_SERVICE_KEY } = require('../config');
const { UpstreamServiceError } = require('../utils/error');
const { logger } = require('../utils/logger');

// One axios instance per downstream microservice. Every call carries
// `x-internal-key` so the target service can tell this is a trusted
// server-to-server call (see auth-service/src/api/internal-controller.js
// for the pattern this mirrors) — NOT a customer-facing request, and
// NOT routed through api-gateway.
//
// This is the only place the admin backend is allowed to reach into another
// service. Repositories/controllers must go through a client, never open a
// second DB connection pointed at another service's database.
function createServiceClient(serviceName, baseURL) {
  const http = axios.create({
    baseURL,
    timeout: 8000,
    headers: { 'x-internal-key': INTERNAL_SERVICE_KEY },
  });

  http.interceptors.response.use(
    (res) => res,
    (err) => {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message;
      logger.error({ service: serviceName, status, message }, `[${serviceName}] request failed`);
      throw UpstreamServiceError(serviceName, message);
    }
  );

  return http;
}

module.exports = { createServiceClient };
