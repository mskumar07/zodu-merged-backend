const dotEnv = require('dotenv');

if (process.env.NODE_ENV !== 'production') {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : './.env';
  dotEnv.config({ path: configFile, quiet: true });
} else {
  dotEnv.config({ quiet: true });
}

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// INTERNAL_SERVICE_TOKEN_AUTH=..., INTERNAL_SERVICE_TOKEN_EMPLOYEE=... → { auth: '...', employee: '...' }.
// One token per calling service, so a leaked token names its source and can be rotated alone.
// Tokens shorter than 32 characters are ignored.
function internalTokens(env = process.env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k, v]) => k.startsWith('INTERNAL_SERVICE_TOKEN_') && v && v.length >= 32)
      .map(([k, v]) => [k.slice('INTERNAL_SERVICE_TOKEN_'.length).toLowerCase(), v]),
  );
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'local',
  PORT: int(process.env.PORT, 4007),
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: int(process.env.DB_PORT, 5432),
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME || 'file_service',
  // Same secret auth-service signs access tokens with (GenerateSignature).
  APP_SECRET: process.env.APP_SECRET,

  // "internal" client: private network, does put/get/stat/remove.
  MINIO_INTERNAL_URL: process.env.MINIO_INTERNAL_URL || 'http://localhost:9000',
  // "signer" client: only presigns. The signature covers the host, so this must
  // be the origin browsers use, e.g. https://files.myzodu.com.
  MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL || process.env.MINIO_INTERNAL_URL || 'http://localhost:9000',
  MINIO_REGION: process.env.MINIO_REGION || 'us-east-1',
  MINIO_ACCESSKEY: process.env.MINIO_ACCESSKEY,
  MINIO_SECRETKEY: process.env.MINIO_SECRETKEY,
  BUCKET_NAME: process.env.MINIO_BUCKET_NAME || 'zodu-files',
  // Old shared bucket, read-only: serves URLs stored before file-service
  // (GET /legacy/*). Empty disables the route.
  LEGACY_BUCKET_NAME: process.env.LEGACY_BUCKET_NAME ?? 'zodu',
  PRESIGNED_URL_TTL: int(process.env.PRESIGNED_URL_TTL, 900),

  // Public origin of the gateway; stable /files/v/:fileId links are built on it.
  PUBLIC_FILE_BASE_URL: (process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:5001').replace(/\/+$/, ''),

  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://auth-service:4000',
  // Token file-service presents to auth-service's /internal/user-branch-access.
  AUTH_INTERNAL_TOKEN: process.env.AUTH_INTERNAL_TOKEN,
  ACCESS_CACHE_TTL_MS: int(process.env.ACCESS_CACHE_TTL_MS, 60_000),
  INTERNAL_TOKENS: internalTokens(),
  internalTokens,

  REDIS_URL: process.env.REDIS_URL,
  MAX_CONCURRENT_UPLOADS: int(process.env.MAX_CONCURRENT_UPLOADS, 4),
  UPLOAD_QUEUE_TIMEOUT_MS: int(process.env.UPLOAD_QUEUE_TIMEOUT_MS, 15_000),
  // Non-accounting files are removed from storage this long after a soft delete.
  PURGE_AFTER_DAYS: int(process.env.PURGE_AFTER_DAYS, 30),
  PURGE_JOB_ENABLED: process.env.PURGE_JOB_ENABLED !== 'false',
  // Uploads to the staging area that no saved record claimed are removed after this.
  STAGING_TTL_HOURS: int(process.env.STAGING_TTL_HOURS, 48),
  // Browser origins allowed to call file-service directly. Normally empty:
  // browsers go through the gateway, which handles CORS.
  CORS_ORIGINS: list(process.env.CORS_ORIGINS),
  // Hops whose X-Forwarded-For is trusted for req.ip (rate limits, access log).
  TRUST_PROXY: process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
};
