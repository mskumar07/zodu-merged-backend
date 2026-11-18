// Error body: { success: false, error, code, details? } (§8.1).
const { logger } = require('./logger');

class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, code = 'VALIDATION_FAILED', details) => new AppError(400, message, code, details);
const forbidden = (message = 'Permission denied', code = 'FORBIDDEN') => new AppError(403, message, code);
const notFound = (message = 'Not found', code = 'NOT_FOUND') => new AppError(404, message, code);
const conflict = (message, code, details) => new AppError(409, message, code, details);
const unprocessable = (message, code, details) => new AppError(422, message, code, details);
const unavailable = (message, code = 'DEPENDENCY_UNAVAILABLE') => new AppError(503, message, code);

// Express error handler. Postgres errors that mean "bad input" or "conflict"
// get their HTTP status; anything else is a 500 with no internals in the body.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return res.end();
  let { status, code } = err;
  let message = err.message;
  let details = err.details;

  if (!(err instanceof AppError)) {
    if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'File or body too large';
    } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400; code = 'TOO_MANY_FILES'; message = 'Too many files';
    } else if (err.type === 'entity.parse.failed') {
      status = 400; code = 'INVALID_JSON'; message = 'Invalid JSON body';
    } else if (err.name === 'FileServiceError') {
      code = 'FILE_SERVICE'; details = undefined;
    } else if (err.code === '23505') {
      status = 409; code = 'CONFLICT'; message = 'Already exists'; details = undefined;
    } else if (err.code === '23514' || err.code === '22007' || err.code === '22008') {
      status = 400; code = 'VALIDATION_FAILED'; message = 'Invalid value'; details = undefined;
    } else if (err.code === '22P02') {
      status = 404; code = 'NOT_FOUND'; message = 'Not found'; details = undefined;
    } else if (err.code === '40001' || err.code === '40P01') {
      status = 409; code = 'RETRY'; message = 'Busy, please retry'; details = undefined;
    } else if (err.code === '57014') {
      status = 503; code = 'TIMEOUT'; message = 'Took too long, please retry'; details = undefined;
    } else if (!status || status >= 500) {
      status = status || 500;
    }
  }
  status = status || 500;
  if (status >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.path, request_id: req.id });
    if (!(err instanceof AppError) && err.name !== 'FileServiceError') message = 'Internal error';
  }
  return res.status(status).json({
    success: false, error: message, code: code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
    ...(details !== undefined && { details }),
  });
}

// async route → errors go to the handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, forbidden, notFound, conflict, unprocessable, unavailable, errorHandler, ah };
