const dotEnv = require("dotenv");

console.log("Loading environment variables...",process.env.NODE_ENV);
if (process.env.NODE_ENV !== "production") {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : "./.env";
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}


module.exports = {
  PORT: process.env.PORT,
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME,
  APP_SECRET: process.env.APP_SECRET,
  MINIO_HOST: process.env.MINIO_HOST || 'localhost',
  MINIO_PORT: process.env.MINIO_PORT,
  MINIO_ACCESSKEY: process.env.MINIO_ACCESSKEY,
  MINIO_SECRETKEY: process.env.MINIO_SECRETKEY,
  BUCKET_NAME: process.env.MINIO_BUCKET_NAME,
  // Origin the stored file URLs are built against. These URLs are handed to
  // browsers and invoice templates as plain <img src>, so it must be the public
  // site, not an internal hostname: api.myzodu.com on UAT, api.zodu.in on prod.
  PUBLIC_FILE_BASE_URL: process.env.PUBLIC_FILE_BASE_URL || 'https://api.myzodu.com',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.APP_SECRET,
  RESTAURANT_SERVICE_URL: process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4001',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002',
  RETAIL_SERVICE_URL: process.env.RETAIL_SERVICE_URL || 'http://retail-service:3001',

};
