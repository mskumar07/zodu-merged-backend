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
  // Employee documents live in file-service; utils/file-client.js reads
  // FILE_SERVICE_URL straight from the environment. Service-to-service tokens
  // (@zodu/security): INTERNAL_TOKEN is sent, INTERNAL_TOKEN_AUTH accepted on /internal/*.
  FILE_SERVICE_URL:    process.env.FILE_SERVICE_URL    || 'http://file-service:4007',
  AUTH_SERVICE_URL:    process.env.AUTH_SERVICE_URL    || 'http://auth-service:4000',
  PAYROLL_SERVICE_URL: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:4004',
  FACE_SERVICE_URL:    process.env.FACE_SERVICE_URL    || 'http://face-service:8000',
  // Cosine similarity a capture must reach to count as the employee's face.
  // buffalo_l puts the same person well above 0.5 and strangers near 0.
  FACE_MIN_SIMILARITY: Number(process.env.FACE_MIN_SIMILARITY) || 0.45,
};
