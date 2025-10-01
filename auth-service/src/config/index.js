const dotEnv = require("dotenv");

console.log("Loading environment variables...",process.env.NODE_ENV);
if (process.env.NODE_ENV !== "production") {
  const configFile = `./.env.${process.env.NODE_ENV}`;
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
  APP_SECRET: process.env.APP_SECRET
};
