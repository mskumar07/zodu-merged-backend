const dotEnv = require('dotenv');

if (process.env.NODE_ENV === 'production') {
  dotEnv.config();
} else {
  dotEnv.config({ path: `./.env.${process.env.NODE_ENV}` });
  dotEnv.config(); // fallback to .env if env-specific file missing
}

module.exports = {
  PORT:                process.env.PORT                || 4006,
  DB_USERNAME:         process.env.DB_USERNAME,
  DB_PASSWORD:         process.env.DB_PASSWORD,
  DB_PORT:             process.env.DB_PORT             || 5432,
  DB_HOSTNAME:         process.env.DB_HOSTNAME         || 'localhost',
  DB_NAME:             process.env.DB_NAME,
  // Attachments live in file-service; utils/file-client.js reads
  // FILE_SERVICE_URL straight from the environment. Service-to-service tokens
  // (@zodu/security): INTERNAL_TOKEN is sent, INTERNAL_TOKEN_AUTH accepted on /internal/*.
  FILE_SERVICE_URL:    process.env.FILE_SERVICE_URL    || 'http://file-service:4007',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002',
  // Access-token keys and the branch-access check (@zodu/security).
  AUTH_SERVICE_URL:    process.env.AUTH_SERVICE_URL    || 'http://auth-service:4000',
};
