// MinIO access for auth-service — the invoice-settings signature image and the
// company logo. It stays deliberately small: same client/bucket and the same
// `/file/:name` streaming route the other services expose, but no sharp
// re-encoding — these are small images, and pulling sharp's native binaries
// into this image to convert two files isn't worth ~100MB.
const Minio = require('minio');
const mime  = require('mime-types');
const {
  MINIO_HOST, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME,
  PUBLIC_FILE_BASE_URL,
} = require('../config');

const minioClient = new Minio.Client({
  endPoint:  MINIO_HOST || 'localhost',
  port:      parseInt(MINIO_PORT, 10) || 9000,
  useSSL:    false,
  accessKey: MINIO_ACCESSKEY,
  secretKey: MINIO_SECRETKEY,
});

// Without credentials every putObject/getObject fails with AccessDenied, which
// looks exactly like a missing file. Say so once at startup instead.
if (!MINIO_ACCESSKEY || !MINIO_SECRETKEY) {
  console.warn(
    '[minio] MINIO_ACCESSKEY / MINIO_SECRETKEY are not set — every file upload and ' +
    'download will fail with AccessDenied. Check the service environment.'
  );
}

const bucketName = BUCKET_NAME || 'zodu';

// Public origin the `/auth/file/:name` URLs are built against — set per
// environment (UAT: https://api.myzodu.com, prod: https://api.zodu.in). Trailing slash
// trimmed so a value with or without one produces the same URL.
const publicBaseUrl = String(PUBLIC_FILE_BASE_URL || 'https://api.myzodu.com').replace(/\/+$/, '');

// Signatures are small; anything larger is a wrong-file mistake, not a signature.
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
// Logos carry more detail than a signature, so they get a little more room.
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

// Shared upload path for both images → { fileUrl, fileKey }
// `label` only shapes the error messages so the client is told which upload
// failed; `keyPrefix` becomes the start of the object key.
const uploadImage = async (file, { label, keyPrefix, maxBytes }) => {
  if (!file || !file.buffer) throw new Error('No file uploaded');

  if (!ALLOWED_MIME.includes(String(file.mimetype).toLowerCase())) {
    throw new Error(`${label} must be a PNG, JPG or WEBP image`);
  }

  if (file.size > maxBytes) {
    throw new Error(`${label} image exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit`);
  }

  const ext = (file.originalname.split('.').pop() || 'png').toLowerCase();
  // Flat key (no slashes) so it still resolves through the `/file/:name` route
  // the other services use, but tagged with the owner so one company's image
  // can never collide with another's.
  const fileKey = `${keyPrefix}-${Date.now()}.${ext}`;

  await minioClient.putObject(bucketName, fileKey, file.buffer, file.buffer.length, {
    'Content-Type': file.mimetype,
  });

  return {
    fileKey,
    fileUrl: `${publicBaseUrl}/auth/file/${fileKey}`,
  };
};

// Upload a signature image → { fileUrl, fileKey }
// fileKey is what gets deleted later; fileUrl is what the invoice template renders.
exports.uploadSignature = (file, zodu_id, branch_id) =>
  uploadImage(file, {
    label: 'Signature',
    keyPrefix: `signature-${zodu_id}-${branch_id}`,
    maxBytes: SIGNATURE_MAX_BYTES,
  });

// Upload a company logo → { fileUrl, fileKey }
// Keyed by company only: the logo belongs to the business, every branch of it
// prints the same one.
exports.uploadCompanyLogo = (file, zodu_id) =>
  uploadImage(file, {
    label: 'Company logo',
    keyPrefix: `company-logo-${zodu_id}`,
    maxBytes: LOGO_MAX_BYTES,
  });

exports.LOGO_MAX_BYTES = LOGO_MAX_BYTES;
exports.SIGNATURE_MAX_BYTES = SIGNATURE_MAX_BYTES;

// Stream a stored file back (GET /file/*)
exports.streamFile = async (fileName, res) => {
  // getObject rejects before any byte is written (NoSuchKey, AccessDenied,
  // connection refused), so the caller can still turn that into a JSON error.
  const fileStream  = await minioClient.getObject(bucketName, fileName);
  const contentType = mime.lookup(fileName) || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${fileName.split('/').pop()}"`);

  // Past this point the headers are out and the status is committed, so a
  // failure cannot become a JSON error — tear the connection down rather than
  // leave the browser hanging on a response that will never complete.
  fileStream.on('error', (err) => {
    console.error(`[minio] stream of ${fileName} failed mid-flight:`, err.message);
    res.destroy(err);
  });

  fileStream.pipe(res);
};

// Best-effort delete — a missing object must not fail the request that
// replaced it, the DB row is the source of truth.
exports.deleteFile = async (fileKey) => {
  if (!fileKey) return;
  await minioClient.removeObject(bucketName, fileKey).catch(() => {});
};

// Recover the object key from a stored image URL (signature_url,
// company_logo_url) so old images can be cleaned up on replace/delete.
exports.keyFromUrl = (url) => {
  if (!url) return null;
  const marker = '/auth/file/';
  const at = String(url).indexOf(marker);
  return at === -1 ? null : String(url).slice(at + marker.length);
};
