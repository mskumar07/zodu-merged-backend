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

module.exports = { imageUpload };
