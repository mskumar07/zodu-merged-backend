// Re-encoding after inspection. Replaces the sharp / pdf-lib code each service
// had in its own utils/minio.js.
//
//   - Every image is re-encoded, which strips EXIF (GPS, camera, owner) and
//     applies the EXIF orientation first so the picture stays upright.
//   - module.transform.image: resize to fit maxPx and convert (e.g. webp).
//   - module.transform.pdf:   rewrite with object streams (smaller files).
//
// Returns { buffer, mime }. The caller re-derives the extension from mime.

const { MIME } = require('./modules');

let sharp;
const getSharp = () => (sharp ??= require('sharp'));

const IMAGE_TYPES = new Set([MIME.JPEG, MIME.PNG, MIME.WEBP]);
const FORMAT_MIME = { webp: MIME.WEBP, jpeg: MIME.JPEG, png: MIME.PNG };
const ENCODE = {
  [MIME.JPEG]: (img) => img.jpeg({ quality: 85, mozjpeg: true }),
  [MIME.PNG]:  (img) => img.png({ compressionLevel: 9 }),
  [MIME.WEBP]: (img) => img.webp({ quality: 82 }),
};

// Pixel cap per decoded image (~ 8k x 8k): refuses decompression bombs.
const LIMIT_INPUT_PIXELS = 8192 * 8192;

async function transformFile(buffer, mime, transform = {}) {
  if (IMAGE_TYPES.has(mime)) return transformImage(buffer, mime, transform.image);
  if (mime === MIME.PDF && transform.pdf) return transformPdf(buffer);
  return { buffer, mime };
}

async function transformImage(buffer, mime, opts) {
  let img = getSharp()(buffer, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' }).rotate();
  let outMime = mime;
  if (opts) {
    if (opts.maxPx) img = img.resize({ width: opts.maxPx, height: opts.maxPx, fit: 'inside', withoutEnlargement: true });
    if (opts.format) outMime = FORMAT_MIME[opts.format];
  }
  // sharp drops all metadata unless asked to keep it.
  const out = await ENCODE[outMime](img).toBuffer();
  return { buffer: out, mime: outMime };
}

async function transformPdf(buffer) {
  const { PDFDocument } = require('pdf-lib');
  try {
    const doc = await PDFDocument.load(buffer, { updateMetadata: false });
    const out = Buffer.from(await doc.save({ useObjectStreams: true }));
    // Only keep the rewrite when it actually helps.
    return { buffer: out.length < buffer.length ? out : buffer, mime: MIME.PDF };
  } catch {
    return { buffer, mime: MIME.PDF };
  }
}

module.exports = { transformFile, LIMIT_INPUT_PIXELS };
