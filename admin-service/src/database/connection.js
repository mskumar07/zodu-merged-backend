const { Pool } = require('pg');
const { DB_USERNAME, DB_PASSWORD, DB_PORT, DB_HOSTNAME, DB_NAME } = require('../config');

const pool = new Pool({
  user: DB_USERNAME,
  host: DB_HOSTNAME,
  database: DB_NAME,
  password: DB_PASSWORD,
  port: Number(DB_PORT),

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Prevent ECONNRESET crashes from taking the process down.
pool.on('error', (err) => {
  if (err.code === 'ECONNRESET') {
    console.warn('⚠️ PostgreSQL ECONNRESET — recovered');
    return;
  }
  console.error('🔥 PostgreSQL pool error:', err);
});

module.exports = pool;
