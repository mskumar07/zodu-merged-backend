const dotEnv = require("dotenv");

console.log("Loading environment variables...",process.env.NODE_ENV);
if (process.env.NODE_ENV !== "production") {
  const configFile = `./.env.${process.env.NODE_ENV}`;
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}

console.log(process.env.PORT)
module.exports = {
  PORT:                process.env.PORT,
  DB_USERNAME:         process.env.DB_USERNAME,
  DB_PASSWORD:         process.env.DB_PASSWORD,
  DB_PORT:             process.env.DB_PORT,
  DB_HOSTNAME:         process.env.DB_HOSTNAME,
  DB_NAME:             process.env.DB_NAME,
  // Employee documents live in file-service; utils/file-client.js reads
  // FILE_SERVICE_URL straight from the environment. Service-to-service tokens
  // (@zodu/security): INTERNAL_TOKEN is sent on calls to auth / payroll / file-service,
  // which hold it as INTERNAL_TOKEN_ATTENDANCE. This service has no /internal routes.
  FILE_SERVICE_URL:    process.env.FILE_SERVICE_URL    || 'http://file-service:4007',
  AUTH_SERVICE_URL:    process.env.AUTH_SERVICE_URL    || 'http://auth-service:4000',
  PAYROLL_SERVICE_URL: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:4004',
};
