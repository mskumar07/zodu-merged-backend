const Minio    = require('minio');
const mime     = require('mime-types');
const {
  MINIO_HOST, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME,
  PUBLIC_FILE_BASE_URL,
} = require('../config');

const minioClient = new Minio.Client({
  endPoint:  MINIO_HOST,
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

exports.uploadFile = async (file, folder = 'checklist-files') => {
  if (!file || !file.buffer) throw new Error('Invalid file input');
  if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds 10MB limit');

  const ext        = file.originalname.split('.').pop().toLowerCase();
  const outputName = `${folder}/${Date.now()}-${file.originalname}`;

  await minioClient.putObject(bucketName, outputName, file.buffer, file.buffer.length, {
    'Content-Type': file.mimetype,
  });

  // Encode each path segment separately so '/' stays a path separator
  const encodedPath = outputName.split('/').map(encodeURIComponent).join('/');

  return {
    fileName: file.originalname,
    fileUrl:  `${publicBaseUrl}/checklist/file/${encodedPath}`,
    fileKey:  outputName,
    fileType: ext,
    fileSizeKb: Math.round(file.size / 1024),
  };
};

exports.streamFile = async (fileName, res) => {
  const fileStream  = await minioClient.getObject(bucketName, fileName);
  const contentType = mime.lookup(fileName) || 'application/octet-stream';

  const inlineTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    inlineTypes.includes(contentType) ? 'inline' : `attachment; filename="${fileName.split('/').pop()}"`
  );
  fileStream.pipe(res);
};

exports.deleteFile = async (fileKey) => {
  if (!fileKey) return;
  await minioClient.removeObject(bucketName, fileKey).catch(() => {});
};

// Named delete — returns success/failure (used by DELETE /delete/file/:name route)
exports.deleteFileByName = async (fileName) => {
  if (!fileName) throw new Error('File name is required');
  await minioClient.removeObject(bucketName, fileName);
  return { success: true, message: 'File deleted successfully' };
};
