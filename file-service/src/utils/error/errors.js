const STATUS_CODES = require('./status-codes');

function BaseError(name, status, description) {
  const error = new Error(description);
  error.name = name;
  error.status = status;
  Error.captureStackTrace(error, BaseError);
  return error;
}

const ValidationError     = (d = 'bad request') => BaseError('bad request', STATUS_CODES.BAD_REQUEST, d);
const AuthenticationError = (d = 'Authentication required') => BaseError('unauthenticated', STATUS_CODES.UNAUTHENTICATED, d);
const ForbiddenError      = (d = 'access denied') => BaseError('access denied', STATUS_CODES.FORBIDDEN, d);
// Cross-tenant / cross-branch access is reported as "not found" so ids can't be probed.
const NotFoundError       = (d = 'File not found') => BaseError('not found', STATUS_CODES.NOT_FOUND, d);
const UnavailableError    = (d = 'Service busy, try again') => BaseError('unavailable', STATUS_CODES.SERVICE_UNAVAILABLE, d);

module.exports = {
  BaseError, ValidationError, AuthenticationError, ForbiddenError, NotFoundError, UnavailableError,
};
