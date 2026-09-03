const Minio  = require('minio');
const sharp  = require('sharp');
const mime   = require('mime-types');
const {
  MINIO_HOST, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME,
  PUBLIC_FILE_BASE_URL,
} = require('../config');

const minioClient = new Minio.Client({
  endPoint:  MINIO_HOST  || 'localhost',
  port:      parseInt(MINIO_PORT) || 9000,
  useSSL:    false,
  accessKey: MINIO_ACCESSKEY,
  secretKey: MINIO_SECRETKEY,
});

const bucketName = BUCKET_NAME || 'zodu';
// Public origin the file URLs are built against — set per environment
// (UAT: https://myzodu.com, prod: https://zodu.in). Trailing slash trimmed so a
// value with or without one produces the same URL.
const publicBaseUrl = String(PUBLIC_FILE_BASE_URL || 'https://myzodu.com').replace(/\/+$/, '');

// Upload file → returns { fileName, fileUrl }
exports.uploadFile = async (file) => {
  if (!file || !file.buffer) throw new Error('Invalid file input');

  if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds 10MB limit');

  const ext = file.originalname.split('.').pop().toLowerCase();
  let buffer     = file.buffer;
  let outputName = `${Date.now()}-${file.originalname}`;

  // Optimize images → convert to webp (same as restaurant-service)
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    buffer = await sharp(file.buffer)
      .resize({ width: 1800, withoutEnlargement: true })
      .toFormat('webp', { quality: 80 })
      .toBuffer();
    outputName = `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}.webp`;
  }

  await minioClient.putObject(bucketName, outputName, buffer, buffer.length, {
    'Content-Type': file.mimetype,
  });

  return {
    fileName: file.originalname,
    fileUrl:  `${publicBaseUrl}/employee/file/${outputName}`,
    fileKey:  outputName,
  };
};

// Stream file from MinIO to response (for GET /file/:name)
exports.streamFile = async (fileName, res) => {
  const fileStream  = await minioClient.getObject(bucketName, fileName);
  const contentType = mime.lookup(fileName) || 'application/octet-stream';

  const inlineTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    inlineTypes.includes(contentType) ? 'inline' : `attachment; filename="${fileName.split('/').pop()}"`
  );

  fileStream.pipe(res);
};

// Delete file from MinIO by key
exports.deleteFile = async (fileKey) => {
  if (!fileKey) return;
  await minioClient.removeObject(bucketName, fileKey).catch(() => {});
};
