const multer = require('multer');
const { logger } = require('../logger');
const STATUS_CODES = require('./status-codes');

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE:       413,
  LIMIT_FILE_COUNT:      400,
  LIMIT_PART_COUNT:      400,
  LIMIT_FIELD_COUNT:     400,
  LIMIT_FIELD_KEY:       400,
  LIMIT_FIELD_VALUE:     400,
  LIMIT_UNEXPECTED_FILE: 400,
};
const MULTER_MESSAGES = {
  LIMIT_FILE_COUNT:      'Too many files in one upload',
  LIMIT_UNEXPECTED_FILE: 'Unexpected upload field: send files in the "files" field',
};

// Maps every error to { success: false, error }. 5xx never leaks internals:
// no stack, no MinIO key or bucket, no SQL.
// eslint-disable-next-line no-unused-vars
const HandleErrorWithLogger = (err, req, res, _next) => {
  let status = Number.isInteger(err.status) ? err.status : STATUS_CODES.INTERNAL_ERROR;
  let message = err.message;

  if (err instanceof multer.MulterError) {
    status = MULTER_ERRORS[err.code] || 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? (err.limitMessage || 'A file exceeds the upload size limit')
      : (MULTER_MESSAGES[err.code] || 'Invalid upload request');
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request body is too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Malformed JSON body';
  } else if (status < 400 || status > 599) {
    status = STATUS_CODES.INTERNAL_ERROR;
  }

  if (status >= 500) {
    (req.log || logger).error({ err }, 'request failed');
    if (status !== STATUS_CODES.SERVICE_UNAVAILABLE) message = 'Internal error';
  }
  if (res.headersSent) return res.destroy();
  return res.status(status).json({
    success: false,
    error: message,
    ...(status < 500 && err.details && { details: err.details }),
  });
};

module.exports = { HandleErrorWithLogger };
