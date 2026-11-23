// Image uploads: multer memory storage, size and count limits, a MIME
// whitelist AND a magic-byte check (the browser's type is never trusted alone).
// file-service inspects the bytes again before it stores anything.
const multer = require('multer');
const { badRequest } = require('./errors');

const MB = 1024 * 1024;
const SIGNATURES = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

function imageUpload({ maxFiles, maxMb = 5, field = 'files' }) {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * MB, files: maxFiles, fields: 10 },
    fileFilter: (req, file, cb) => cb(null, Object.hasOwn(SIGNATURES, file.mimetype)),
  }).array(field, maxFiles);

  return [
    parse,
    (req, res, next) => {
      const list = req.files || [];
      for (const f of list) {
        if (!SIGNATURES[f.mimetype]?.(f.buffer)) {
          return next(badRequest(`"${String(f.originalname).slice(0, 80)}" is not a JPG, PNG or WebP image`, 'INVALID_FILE_TYPE'));
        }
      }
      return next();
    },
  ];
}

// Reference files on a task: the images above plus PDF, Word and Excel.
// DOCX / XLSX are zip containers and DOC an OLE file: the magic bytes say which
// family, file-service tells DOCX from XLSX by the content before it stores anything.
const ZIP = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const DOC_SIGNATURES = {
  ...SIGNATURES,
  'application/pdf': (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  'application/msword': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
};

function documentUpload({ maxFiles, maxMb = 10, field = 'files' }) {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * MB, files: maxFiles, fields: 10 },
    fileFilter: (req, file, cb) => cb(null, Object.hasOwn(DOC_SIGNATURES, file.mimetype)),
  }).array(field, maxFiles);

  return [
    parse,
    (req, res, next) => {
      for (const f of req.files || []) {
        if (!DOC_SIGNATURES[f.mimetype]?.(f.buffer)) {
          return next(badRequest(`"${String(f.originalname).slice(0, 80)}" is not a photo, PDF, Word or Excel file`, 'INVALID_FILE_TYPE'));
        }
      }
      return next();
    },
  ];
}

module.exports = { imageUpload, documentUpload };
