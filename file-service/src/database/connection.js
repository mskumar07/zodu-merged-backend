const { Pool } = require('pg');
const {
  DB_USERNAME, DB_PASSWORD, DB_PORT, DB_HOSTNAME, DB_NAME,
} = require('../config');
const { logger } = require('../utils/logger');

const pool = new Pool({
  user: DB_USERNAME,
  host: DB_HOSTNAME,
  database: DB_NAME,
  password: DB_PASSWORD,
  port: DB_PORT,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// An idle client dropping (ECONNRESET) must not crash the process.
pool.on('error', (err) => logger.warn({ err: err.message }, 'PostgreSQL pool error'));

module.exports = pool;
