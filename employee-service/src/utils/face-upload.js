const multer = require('multer');

// Face photos stay in memory — they go to face-service for an embedding and
// are never stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    ['image/jpeg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPG or PNG photos are allowed'));
  },
});

/** multer.single([field]) that answers bad uploads with a 400, not a 500. */
module.exports = (field) => (req, res, next) =>
  upload.single(field)(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });

/** Responds with a service error's status (BaseError) or 500. */
module.exports.sendError = (res, err) => {
  const status = (err.status >= 400 && err.status < 500) || err.status === 503
    ? err.status
    : 500;
  if (status === 500) console.error(err);
  return res.status(status).json({ success: false, message: err.message });
};
