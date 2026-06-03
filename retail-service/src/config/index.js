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
  PORT: process.env.PORT,
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME,
  APP_SECRET: process.env.APP_SECRET,
MINIO_HOST: process.env.MINIO_HOST,
MINIO_PORT: parseInt(process.env.MINIO_PORT),
MINIO_ACCESSKEY: process.env.MINIO_ACCESSKEY,
MINIO_SECRETKEY: process.env.MINIO_SECRETKEY,
BUCKET_NAME: process.env.MINIO_BUCKET_NAME
};
