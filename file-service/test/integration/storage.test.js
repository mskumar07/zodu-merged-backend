// Real MinIO + Postgres. Start them, then run:
//   docker compose -f file-service/docker-compose.test.yml up -d
//   npm run test:integration          (from file-service/)
// Skipped unless FILE_IT=1 (the compose file's defaults are used otherwise).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const enabled = process.env.FILE_IT === '1';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOSTNAME: process.env.DB_HOSTNAME || 'localhost',
  DB_PORT: process.env.DB_PORT || '55432',
  DB_USERNAME: process.env.DB_USERNAME || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DB_NAME: process.env.DB_NAME || 'file_service',
  MINIO_INTERNAL_URL: process.env.MINIO_INTERNAL_URL || 'http://localhost:59000',
  MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL || 'http://localhost:59000',
  MINIO_ACCESSKEY: process.env.MINIO_ACCESSKEY || 'it-admin',
  MINIO_SECRETKEY: process.env.MINIO_SECRETKEY || 'it-admin-secret',
  MINIO_BUCKET_NAME: 'zodu-files-it',
});

test('upload → presigned GET → stream → delete → purge, on real MinIO and Postgres', { skip: !enabled && 'set FILE_IT=1' }, async () => {
  const request = require('supertest');
  const {
    makeApp, token, verifier, PNG,
  } = require('../helpers');
  const { createApp } = require('../../src/express-app');
  const { createMemoryStore } = require('../../src/middleware/rate-limit');
  const { createPurgeJob } = require('../../src/jobs/purge-deleted');
  const repo = require('../../src/repository/file-repo');
  const storage = require('../../src/storage/minio-client');
  const pool = require('../../src/database/connection');

  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/001_files.sql'), 'utf8'));
  // Runs twice: the migration must be idempotent.
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/001_files.sql'), 'utf8'));
  if (!(await storage.internal.bucketExists(storage.bucket))) await storage.internal.makeBucket(storage.bucket);

  const { authClient } = makeApp();   // fake auth-service, real everything else
  const app = createApp({
    config: {
      PRESIGNED_URL_TTL: 900, PUBLIC_FILE_BASE_URL: 'http://gw',
      INTERNAL_TOKENS: {}, MAX_CONCURRENT_UPLOADS: 2, UPLOAD_QUEUE_TIMEOUT_MS: 5000, CORS_ORIGINS: [], TRUST_PROXY: false,
    },
    repo, storage, authClient, tokenVerifier: verifier, rateLimitStore: createMemoryStore(),
  });
  const headers = { Authorization: `Bearer ${token()}` };   // branch B1 from the token

  const up = await request(app).post('/checklist/CHK1?category=attachments').set(headers).attach('files', PNG, 'proof.png');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const id = up.body.data[0].file_id;

  const { rows: [row] } = await pool.query('SELECT * FROM tbl_files WHERE file_id = $1', [id]);
  assert.match(row.object_key, /^Z001\/B1\/checklist\/CHK1\/attachments\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);

  const signed = await request(app).get(`/${id}/url?download=1`).set(headers);
  const res = await fetch(signed.body.data.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="proof.png"/);

  const streamed = await request(app).get(`/${id}/content`).set(headers);
  assert.equal(streamed.status, 200);
  assert.equal(Number(streamed.headers['content-length']), Number(row.size_bytes));

  assert.equal((await request(app).delete(`/${id}`).set(headers)).status, 200);
  const { rows: log } = await pool.query('SELECT action FROM tbl_file_access_log WHERE file_id = $1 ORDER BY id', [id]);
  assert.deepEqual(log.map((l) => l.action), ['url', 'url', 'content', 'delete']);

  // -1 days: purge everything deleted so far.
  await createPurgeJob({ repo, storage, olderThanDays: -1 }).runOnce();
  await assert.rejects(storage.internal.statObject(storage.bucket, row.object_key));
  const { rows: [after] } = await pool.query('SELECT purged_at FROM tbl_files WHERE file_id = $1', [id]);
  assert.ok(after.purged_at);

  await pool.end();
});
