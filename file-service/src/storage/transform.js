// Compression and clean-up after inspection. Replaces the sharp / pdf-lib code
// each service had in its own utils/minio.js.
//
//   - Every image is re-encoded at visually lossless settings: JPEG / WebP at
//     quality 90 (mozjpeg, sharp chroma), PNG and PNG → WebP losslessly. This
//     strips EXIF (GPS, camera, owner) and applies the EXIF orientation first
//     so the picture stays upright. The colour profile is kept, so colours
//     don't shift.
//   - When re-encoding doesn't make the file smaller and there is nothing to
//     strip, rotate or resize, the upload is stored exactly as it came.
//   - module.transform.image: shrink to fit maxPx (never enlarge) and convert (e.g. webp).
//   - module.transform.pdf:   rewrite with object streams. Lossless: page content
//     and images are untouched. Kept only when smaller; signed PDFs are never rewritten.
//
// Returns { buffer, mime }. The caller re-derives the extension from mime.

const { MIME } = require('./modules');

let sharp;
const getSharp = () => (sharp ??= require('sharp'));

const IMAGE_TYPES = new Set([MIME.JPEG, MIME.PNG, MIME.WEBP]);
const FORMAT_MIME = { webp: MIME.WEBP, jpeg: MIME.JPEG, png: MIME.PNG };
const QUALITY = 90;
const ENCODE = {
  [MIME.JPEG]: (img) => img.jpeg({ quality: QUALITY, mozjpeg: true }),
  // No effort / quality / colours here: any of them switches sharp to a lossy 256-colour palette.
  [MIME.PNG]:  (img) => img.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }),
  // A PNG source is a logo, signature or screenshot: lossless keeps its edges and text sharp.
  [MIME.WEBP]: (img, from) => (from === MIME.PNG
    ? img.webp({ lossless: true, effort: 5 })
    : img.webp({ quality: QUALITY, smartSubsample: true, effort: 5 })),
};

// Pixel cap per decoded image (~ 8k x 8k): refuses decompression bombs.
const LIMIT_INPUT_PIXELS = 8192 * 8192;

async function transformFile(buffer, mime, transform = {}) {
  if (IMAGE_TYPES.has(mime)) return transformImage(buffer, mime, transform.image);
  if (mime === MIME.PDF && transform.pdf) return transformPdf(buffer);
  return { buffer, mime };
}

// Nothing private to strip and nothing to rotate.
const isClean = (meta) => !meta.exif && !meta.xmp && !meta.iptc && !meta.comments?.length
  && (meta.orientation ?? 1) === 1;

async function transformImage(buffer, mime, opts = {}) {
  const input = { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' };
  const meta = await getSharp()(buffer, input).metadata();
  const shrink = Boolean(opts.maxPx) && Math.max(meta.width, meta.height) > opts.maxPx;

  let img = getSharp()(buffer, input).rotate().keepIccProfile();
  if (shrink) img = img.resize({ width: opts.maxPx, height: opts.maxPx, fit: 'inside', withoutEnlargement: true });
  const outMime = FORMAT_MIME[opts.format] ?? mime;
  // sharp drops EXIF / XMP / IPTC unless asked to keep them.
  const out = await ENCODE[outMime](img, mime).toBuffer();

  if (!shrink && out.length >= buffer.length && isClean(meta)) return { buffer, mime };
  return { buffer: out, mime: outMime };
}

async function transformPdf(buffer) {
  // A rewrite would break a digital signature (it covers the original bytes).
  if (buffer.includes('/ByteRange')) return { buffer, mime: MIME.PDF };
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
