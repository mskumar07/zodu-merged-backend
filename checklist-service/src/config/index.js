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
  APP_SECRET:          process.env.APP_SECRET,
  MINIO_HOST:          process.env.MINIO_HOST          || 'localhost',
  MINIO_PORT:          process.env.MINIO_PORT          || 9000,
  MINIO_ACCESSKEY:     process.env.MINIO_ACCESSKEY,
  MINIO_SECRETKEY:     process.env.MINIO_SECRETKEY,
  BUCKET_NAME:         process.env.MINIO_BUCKET_NAME,
  // Origin the stored file URLs are built against. These URLs are handed to
  // browsers as plain <img src>, so it must be the public site, not an internal
  // hostname: api.myzodu.com on UAT, api.zodu.in on prod.
  PUBLIC_FILE_BASE_URL: process.env.PUBLIC_FILE_BASE_URL || 'https://api.myzodu.com',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4003',
};
