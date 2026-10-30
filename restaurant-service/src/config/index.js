const dotEnv = require("dotenv");

console.log("Loading environment variables...",process.env.NODE_ENV);
if (process.env.NODE_ENV !== "production") {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : "./.env";
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}

console.log(process.env.PORT)
module.exports = {
  // Files live in file-service; utils/file-client.js reads FILE_SERVICE_URL and
  // FILE_SERVICE_TOKEN (= file-service's INTERNAL_SERVICE_TOKEN_RESTAURANT) from the environment.
  FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://file-service:4007',
  PORT:            process.env.PORT,
  DB_USERNAME:     process.env.DB_USERNAME,
  DB_PASSWORD:     process.env.DB_PASSWORD,
  DB_PORT:         process.env.DB_PORT,
  DB_HOSTNAME:     process.env.DB_HOSTNAME,
  DB_NAME:         process.env.DB_NAME,
  APP_SECRET:      process.env.APP_SECRET,
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://localhost:3000',
};
