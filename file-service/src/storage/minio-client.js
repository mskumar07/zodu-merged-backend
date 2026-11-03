const Minio = require('minio');
const {
  MINIO_INTERNAL_URL, MINIO_PUBLIC_URL, MINIO_REGION, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME,
} = require('../config');

function clientFor(url) {
  const u = new URL(url);
  const useSSL = u.protocol === 'https:';
  return new Minio.Client({
    endPoint:  u.hostname,
    port:      u.port ? Number(u.port) : (useSSL ? 443 : 80),
    useSSL,
    accessKey: MINIO_ACCESSKEY,
    secretKey: MINIO_SECRETKEY,
    // A fixed region stops the client asking the server for it, which the
    // signer can't do (its host is only reachable from the internet).
    region:    MINIO_REGION,
  });
}

// Private network: put / get / stat / remove.
const internal = clientFor(MINIO_INTERNAL_URL);
// Presigning only: the signature covers the host, so it must be the public one.
const signer = clientFor(MINIO_PUBLIC_URL);

// The bucket is created by the setup runbook (docs/file-service/minio-setup.md)
// with versioning, encryption and no anonymous access; the service's MinIO
// user can't create buckets. This only checks it is reachable.
async function assertBucket() {
  if (!(await internal.bucketExists(BUCKET_NAME))) {
    throw new Error(`MinIO bucket "${BUCKET_NAME}" does not exist`);
  }
}

module.exports = { internal, signer, bucket: BUCKET_NAME, assertBucket };
