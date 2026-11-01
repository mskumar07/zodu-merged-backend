const dotEnv = require("dotenv");

console.log("Loading environment variables...",process.env.NODE_ENV);
if (process.env.NODE_ENV !== "production") {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : "./.env";
  dotEnv.config({ path: configFile });
} else {
  dotEnv.config();
}

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const bool = (v, d = false) => (v === undefined || v === '' ? d : v === 'true');

module.exports = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME,
  // Old HS256 secret: only verifies the refresh tokens issued before the ES256
  // switch (legacy migration, until LEGACY_REFRESH_CUTOFF).
  APP_SECRET: process.env.APP_SECRET,
  // Files (logo, invoice images) live in file-service; utils/file-client.js
  // reads FILE_SERVICE_URL straight from the environment.
  FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://file-service:4007',
  RESTAURANT_SERVICE_URL: process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:4001',
  EMPLOYEE_SERVICE_URL: process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002',
  RETAIL_SERVICE_URL: process.env.RETAIL_SERVICE_URL || 'http://retail-service:3001',
  PAYROLL_SERVICE_URL: process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:3005',
  CHECKLIST_SERVICE_URL: process.env.CHECKLIST_SERVICE_URL || 'http://checklist-service:3006',
  // Service-to-service tokens (@zodu/security): INTERNAL_TOKEN is sent on this
  // service's calls; INTERNAL_TOKEN_<CALLER> are accepted on /internal/*.

  // ── Tokens (docs/security/auth.md) ─────────────────────────────────────────
  // ES256 signing key (PKCS#8 PEM, or that PEM base64-encoded) and its key id.
  JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
  JWT_KID: process.env.JWT_KID,
  // The key being rotated out: still published in the JWKS, never used to sign.
  JWT_PREVIOUS_PUBLIC_KEY: process.env.JWT_PREVIOUS_PUBLIC_KEY,
  JWT_PREVIOUS_KID: process.env.JWT_PREVIOUS_KID,
  JWT_ISSUER: process.env.JWT_ISSUER,
  JWT_AUDIENCE: process.env.JWT_AUDIENCE,
  ACCESS_TOKEN_TTL_SECONDS: int(process.env.ACCESS_TOKEN_TTL_SECONDS, 15 * 60),
  // A refresh token unused this long expires (idle timeout); a session never
  // lives longer than SESSION_MAX_DAYS, however often it is refreshed.
  REFRESH_IDLE_DAYS: int(process.env.REFRESH_IDLE_DAYS, 30),
  SESSION_MAX_DAYS: int(process.env.SESSION_MAX_DAYS, 90),
  // Parallel requests that all hit an expired access token refresh with the
  // same token: inside this window they get the same successor instead of
  // tripping reuse detection.
  REFRESH_REUSE_GRACE_SECONDS: int(process.env.REFRESH_REUSE_GRACE_SECONDS, 30),
  // Path of the web refresh cookie as the browser sees it (through the gateway).
  REFRESH_COOKIE_PATH: process.env.REFRESH_COOKIE_PATH || '/auth/api',
  // false until the client releases send X-Client-Platform (Phase 4 turns it on).
  AUTH_REQUIRE_PLATFORM_HEADER: bool(process.env.AUTH_REQUIRE_PLATFORM_HEADER),
  // Old HS256 refresh tokens are exchanged once until this date (YYYY-MM-DD). Unset: still accepted.
  LEGACY_REFRESH_CUTOFF: process.env.LEGACY_REFRESH_CUTOFF,

  // ── Login protection ───────────────────────────────────────────────────────
  LOGIN_RATE_LIMIT_PER_MIN: int(process.env.LOGIN_RATE_LIMIT_PER_MIN, 20),
  LOGIN_MAX_FAILURES: int(process.env.LOGIN_MAX_FAILURES, 5),
  LOGIN_LOCKOUT_MINUTES: int(process.env.LOGIN_LOCKOUT_MINUTES, 15),
  SIGNUP_RATE_LIMIT_PER_MIN: int(process.env.SIGNUP_RATE_LIMIT_PER_MIN, 5),

  REDIS_URL: process.env.REDIS_URL,
  TRUST_PROXY: process.env.TRUST_PROXY,
};
