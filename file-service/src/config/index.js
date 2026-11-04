const dotEnv = require('dotenv');
const { callerTokensFromEnv, jwksUrlFromEnv } = require('@zodu/security');

if (process.env.NODE_ENV !== 'production') {
  const configFile = process.env.NODE_ENV ? `./.env.${process.env.NODE_ENV}` : './.env';
  dotEnv.config({ path: configFile, quiet: true });
} else {
  dotEnv.config({ quiet: true });
}

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'local',
  PORT: int(process.env.PORT, 4007),
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: int(process.env.DB_PORT, 5432),
  DB_HOSTNAME: process.env.DB_HOSTNAME,
  DB_NAME: process.env.DB_NAME || 'file_service',

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
  // Signs /files/v/:id and old /{service}/file/* URLs into expiring links
  // (storage/signed-links.js). At least 32 characters, the same on every instance.
  FILE_LINK_SECRET: process.env.FILE_LINK_SECRET,
  // true: those URLs also work unsigned (public, as before). Only for a rollout.
  FILE_LINKS_UNSIGNED: process.env.FILE_LINKS_UNSIGNED === 'true',
  // true: those URLs also need the Bearer token of the user they were signed for
  // (storage/link-access.js). Turn on once the apps load images with the token.
  FILE_LINKS_REQUIRE_AUTH: process.env.FILE_LINKS_REQUIRE_AUTH === 'true',
  PRESIGNED_URL_TTL: int(process.env.PRESIGNED_URL_TTL, 900),

  // Public origin of the gateway; /files/v/:fileId links are built on it.
  PUBLIC_FILE_BASE_URL: (process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:5001').replace(/\/+$/, ''),

  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://auth-service:4000',
  // Access tokens are checked against auth-service's public keys (ES256).
  AUTH_JWKS_URL: jwksUrlFromEnv({ AUTH_SERVICE_URL: 'http://auth-service:4000', ...process.env }),
  // Refuse tokens of sessions revoked in the last 15 minutes (Redis deny-list).
  AUTH_CHECK_REVOKED_SESSIONS: process.env.AUTH_CHECK_REVOKED_SESSIONS === 'true',
  ACCESS_CACHE_TTL_MS: int(process.env.ACCESS_CACHE_TTL_MS, 60_000),
  // This service's own token, sent to auth-service's /internal/user-branch-access.
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN,
  // Services allowed to call /internal/*: INTERNAL_TOKEN_AUTH=..., INTERNAL_TOKEN_RETAIL=...
  // → { auth: '...', retail: '...' }. One token per caller; under 32 characters is ignored.
  INTERNAL_TOKENS: callerTokensFromEnv(),

  REDIS_URL: process.env.REDIS_URL,
  MAX_CONCURRENT_UPLOADS: int(process.env.MAX_CONCURRENT_UPLOADS, 4),
  UPLOAD_QUEUE_TIMEOUT_MS: int(process.env.UPLOAD_QUEUE_TIMEOUT_MS, 15_000),
  // Non-accounting files are removed from storage this long after a soft delete.
  PURGE_AFTER_DAYS: int(process.env.PURGE_AFTER_DAYS, 30),
  PURGE_JOB_ENABLED: process.env.PURGE_JOB_ENABLED !== 'false',
  // Uploads to the staging area that no saved record claimed are removed after
  // this many hours. 0 (the default) keeps them: some saved fields (branch
  // image, bulk-import item images) still point at staged files until Phase 3
  // moves them; switch it on (e.g. 48) after that.
  STAGING_TTL_HOURS: int(process.env.STAGING_TTL_HOURS, 0),
  // Browser origins allowed to call file-service directly. Normally empty:
  // browsers go through the gateway, which handles CORS.
  CORS_ORIGINS: list(process.env.CORS_ORIGINS),
  // Origins allowed to show files in a frame (PDF previews), e.g. the gateway's
  // CORS_ORIGINS. Empty: any page may frame them (they can't run code either way).
  FRAME_ANCESTORS: list(process.env.FRAME_ANCESTORS),
  // Hops whose X-Forwarded-For is trusted for req.ip (rate limits, access log).
  TRUST_PROXY: process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal',
};
