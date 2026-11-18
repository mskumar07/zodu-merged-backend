const { Pool, types } = require('pg');
const config = require('../config');
const { logger } = require('../utils/logger');

// date → 'YYYY-MM-DD' (a local calendar day, never shifted by the Node time zone).
types.setTypeParser(1082, (v) => v);
// count(*) and other int8 → number (all our counts are far below 2^53).
types.setTypeParser(20, (v) => Number(v));

const connection = () => ({
  user: config.DB_USERNAME,
  host: config.DB_HOSTNAME,
  database: config.DB_NAME,
  password: config.DB_PASSWORD,
  port: Number(config.DB_PORT),
});

const pool = new Pool({
  ...connection(),
  max: config.DB_POOL_MAX,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => logger.error('pg pool error', { error: err.message, code: err.code }));

module.exports = pool;
module.exports.connection = connection;
