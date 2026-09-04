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
  APP_SECRET:          process.env.APP_SECRET,
  MINIO_HOST:          process.env.MINIO_HOST || 'localhost',
  MINIO_PORT:          process.env.MINIO_PORT,
  MINIO_ACCESSKEY:     process.env.MINIO_ACCESSKEY,
  MINIO_SECRETKEY:     process.env.MINIO_SECRETKEY,
  BUCKET_NAME:         process.env.MINIO_BUCKET_NAME,
  // Origin the stored file URLs are built against. These URLs are handed to
  // browsers as plain <img src>, so it must be the public site, not an internal
  // hostname: api.myzodu.com on UAT, api.zodu.in on prod.
  PUBLIC_FILE_BASE_URL: process.env.PUBLIC_FILE_BASE_URL || 'https://api.myzodu.com',
  AUTH_SERVICE_URL:    process.env.AUTH_SERVICE_URL    || 'http://auth-service:4000',
  PAYROLL_SERVICE_URL: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:4004',
};
