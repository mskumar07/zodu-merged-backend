const dotEnv = require('dotenv');

if (process.env.NODE_ENV !== 'production') {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : './.env';
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}

module.exports = {
  PORT: process.env.PORT || 3007,

  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME,

  APP_SECRET: process.env.APP_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',

  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // Shared secret every downstream service call carries as `x-internal-key`.
  // Each service must validate it on its /internal (or /admin) routes.
  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,

  // Same env-driven service discovery pattern used by api-gateway / auth-service.
  SERVICES: {
    auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:3000',
    retail: process.env.RETAIL_SERVICE_URL || 'http://retail-service:3001',
    employee: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:3002',
    payroll: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:3003',
    restaurant: process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:3004',
    checklist: process.env.CHECKLIST_SERVICE_URL || 'http://checklist-service:3005',
  },
};
