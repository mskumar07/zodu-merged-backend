const dotEnv = require('dotenv');

if (process.env.NODE_ENV === 'production') {
  dotEnv.config();
} else {
  dotEnv.config({ path: `./.env.${process.env.NODE_ENV}` });
  dotEnv.config(); // fallback to .env if the env-specific file is missing
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// ROLE=api (HTTP + SSE + LISTEN) or ROLE=worker (tick, directory sync).
// `node src/server.js --worker` works too (Windows shells have no VAR=x prefix).
const ROLE = process.argv.includes('--worker') ? 'worker' : (process.env.ROLE || 'api');

module.exports = {
  ROLE,
  PORT: num(process.env.PORT, 4008),
  // The worker's own /health/live and /health/ready (no traffic; not proxied).
  WORKER_HEALTH_PORT: num(process.env.WORKER_HEALTH_PORT, 4018),

  DB_HOSTNAME: process.env.DB_HOSTNAME || 'localhost',
  DB_PORT: num(process.env.DB_PORT, 5432),
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME || 'checklist_v2_service',
  DB_POOL_MAX: num(process.env.DB_POOL_MAX, 20),
  DB_STATEMENT_TIMEOUT_MS: num(process.env.DB_STATEMENT_TIMEOUT_MS, 15000),

  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  GENERATION_HORIZON_HOURS: num(process.env.GENERATION_HORIZON_HOURS, 36),
  TICK_INTERVAL_MS: num(process.env.TICK_INTERVAL_MS, 60000),
  DIRECTORY_SYNC_INTERVAL_MS: num(process.env.DIRECTORY_SYNC_INTERVAL_MS, 600000),

  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://auth-service:4000',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002',
  FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://file-service:4007',

  // Per-user limits on item updates and photo uploads (shared through Redis when set).
  REDIS_URL: process.env.REDIS_URL || '',

  SSE_HEARTBEAT_MS: num(process.env.SSE_HEARTBEAT_MS, 20000),
  SSE_MAX_STREAMS_PER_USER: num(process.env.SSE_MAX_STREAMS_PER_USER, 5),
};
