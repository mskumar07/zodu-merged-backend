const axios = require('axios');
const { createInternalHttp } = require('@zodu/security');
const { UpstreamServiceError } = require('../utils/error');
const { logger } = require('../utils/logger');

// One axios instance per downstream microservice. Every call carries this
// service's X-Internal-Token (INTERNAL_TOKEN, @zodu/security); the target's
// /internal routes accept only the services they name — NOT a
// customer-facing request, and NOT routed through api-gateway.
//
// This is the only place the admin backend is allowed to reach into another
// service. Repositories/controllers must go through a client, never open a
// second DB connection pointed at another service's database.
function createServiceClient(serviceName, baseURL) {
  const http = createInternalHttp(axios, { baseURL, timeout: 8000 });

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
