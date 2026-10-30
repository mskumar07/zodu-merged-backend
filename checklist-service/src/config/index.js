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
  // Attachments live in file-service; utils/file-client.js reads
  // FILE_SERVICE_URL and FILE_SERVICE_TOKEN (= file-service's
  // INTERNAL_SERVICE_TOKEN_CHECKLIST) straight from the environment.
  FILE_SERVICE_URL:    process.env.FILE_SERVICE_URL    || 'http://file-service:4007',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4003',
};
