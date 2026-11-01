// Runs before every test file, before any service module is loaded: points
// config at the test database and Redis, with small limits and a fixed key.
const crypto = require('crypto');

const db = JSON.parse(process.env.__TEST_DB);
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DB_HOSTNAME: db.host,
  DB_PORT: String(db.port),
  DB_USERNAME: db.user,
  DB_PASSWORD: db.password,
  DB_NAME: db.database,
  REDIS_URL: process.env.__TEST_REDIS_URL,
  APP_SECRET: 'legacy-app-secret-for-tests-only-0123456789',
  JWT_PRIVATE_KEY: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }),
  JWT_KID: 'test-key-1',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  LOGIN_RATE_LIMIT_PER_MIN: '1000',
  SIGNUP_RATE_LIMIT_PER_MIN: '1000',
  LOGIN_MAX_FAILURES: '5',
  LOGIN_LOCKOUT_MINUTES: '15',
  REFRESH_REUSE_GRACE_SECONDS: '30',
  // Nothing listens here: calls to other services fail fast (they are non-fatal).
  EMPLOYEE_SERVICE_URL: 'http://127.0.0.1:9',
  RESTAURANT_SERVICE_URL: 'http://127.0.0.1:9',
  RETAIL_SERVICE_URL: 'http://127.0.0.1:9',
  FILE_SERVICE_URL: 'http://127.0.0.1:9',
  INTERNAL_TOKEN: 'a'.repeat(64),
  INTERNAL_TOKEN_EMPLOYEE: 'e'.repeat(64),
  INTERNAL_TOKEN_FILE: 'f'.repeat(64),
});
delete process.env.LEGACY_REFRESH_CUTOFF;
delete process.env.AUTH_REQUIRE_PLATFORM_HEADER;
