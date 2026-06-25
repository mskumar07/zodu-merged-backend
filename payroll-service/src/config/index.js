const dotEnv = require('dotenv');

if (process.env.NODE_ENV !== 'production') {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : './.env';
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}

module.exports = {
  PORT:             process.env.PORT || 4004,
  DB_USERNAME:      process.env.DB_USERNAME,
  DB_PASSWORD:      process.env.DB_PASSWORD,
  DB_PORT:          process.env.DB_PORT,
  DB_HOSTNAME:      process.env.DB_HOSTNAME,
  DB_NAME:          process.env.DB_NAME,
  APP_SECRET:       process.env.APP_SECRET,
};
