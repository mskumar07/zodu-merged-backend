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
  // Files (logo, invoice images) live in file-service; utils/file-client.js
  // reads FILE_SERVICE_URL straight from the environment.
  FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://file-service:4007',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.APP_SECRET,
  RESTAURANT_SERVICE_URL: process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4001',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002',
  RETAIL_SERVICE_URL: process.env.RETAIL_SERVICE_URL || 'http://retail-service:3001',
  PAYROLL_SERVICE_URL: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:3005',
  CHECKLIST_SERVICE_URL: process.env.CHECKLIST_SERVICE_URL || 'http://checklist-service:3006',
  // Service-to-service tokens (@zodu/security): INTERNAL_TOKEN is sent on this
  // service's calls; INTERNAL_TOKEN_<CALLER> are accepted on /internal/*.

};
