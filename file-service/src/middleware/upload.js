// Multipart parsing with the POC's limits, plus a cap on concurrent uploads per
// instance. Files are held in memory (multer memoryStorage), so without the cap
// a burst of 10 x 10MB uploads could exhaust the container's memory.
//
// At higher volume the next step is direct-to-MinIO presigned PUT uploads with
// a post-upload inspection step, so file bytes never pass through this service.

const multer = require('multer');
const { MAX_FILES_PER_UPLOAD, getModule } = require('../storage/modules');
const { UnavailableError } = require('../utils/error/errors');

// The module decides the per-file limit, so a 25MB report limit doesn't let
// 25MB through for a 1MB signature. One multer instance per size.
const uploaders = new Map();
function uploaderFor(maxSizeMb) {
  if (!uploaders.has(maxSizeMb)) {
    const upload = multer({
      storage: multer.memoryStorage(),
      defParamCharset: 'utf8',              // non-English file names arrive intact
      limits: {
        fileSize:      maxSizeMb * 1024 * 1024,
        files:         MAX_FILES_PER_UPLOAD,
        fields:        5,
        parts:         MAX_FILES_PER_UPLOAD + 5,
        fieldNameSize: 50,
        fieldSize:     1024,
        headerPairs:   50,
      },
    });
    // "files" for multiple, "file" kept for single-file clients and curl examples.
    uploaders.set(maxSizeMb, upload.fields([
      { name: 'files', maxCount: MAX_FILES_PER_UPLOAD },
      { name: 'file',  maxCount: 1 },
    ]));
  }
  return uploaders.get(maxSizeMb);
}

// moduleOf(req) → module name (path param for users, query for /internal/upload).
function acceptFiles(moduleOf) {
  return (req, res, next) => {
    let mod;
    try {
      mod = getModule(moduleOf(req));
    } catch (err) {
      return next(err);
    }
    uploaderFor(mod.maxSizeMb)(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') err.limitMessage = `A file exceeds the ${mod.maxSizeMb}MB limit for this module`;
      if (err) return next(err);
      req.uploadedFiles = [...(req.files?.files || []), ...(req.files?.file || [])];
      next();
    });
  };
}

// Counting semaphore. Waiters queue up to timeoutMs, then get a 503.
function createUploadSlots({ max, timeoutMs }) {
  let active = 0;
  const waiting = [];

  function release() {
    const nextWaiter = waiting.shift();
    if (nextWaiter) {
      clearTimeout(nextWaiter.timer);
      nextWaiter.grant();
    } else {
      active--;
    }
  }

  function acquire() {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { grant: resolve };
      waiter.timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(waiter), 1);
        reject(UnavailableError('Too many uploads in progress, try again shortly'));
      }, timeoutMs);
      waiting.push(waiter);
    });
  }

  // Middleware: hold a slot from before the body is read until the response ends.
  function middleware(req, res, next) {
    acquire().then(() => {
      let released = false;
      const done = () => { if (!released) { released = true; release(); } };
      res.on('finish', done);
      res.on('close', done);
      next();
    }, next);
  }

  return { middleware, stats: () => ({ active, waiting: waiting.length }) };
}

module.exports = { acceptFiles, createUploadSlots };
