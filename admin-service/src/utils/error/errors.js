const STATUS_CODES = require('./status-codes');

function BaseError(name, status, description) {
  const error = new Error(description);
  error.name = name;
  error.status = status;
  error.message = description;
  Error.captureStackTrace(error, BaseError);
  return error;
}

const APIError = (description = 'api error') =>
  BaseError('api internal server error', STATUS_CODES.INTERNAL_ERROR, description);

const ValidationError = (description = 'bad request') =>
  BaseError('bad request', STATUS_CODES.BAD_REQUEST, description);

const AuthorizeError = (description = 'access denied') =>
  BaseError('access denied', STATUS_CODES.UN_AUTHORISED, description);

const ForbiddenError = (description = 'forbidden') =>
  BaseError('forbidden', STATUS_CODES.FORBIDDEN, description);

const NotFoundError = (description = 'not found') =>
  BaseError(description, STATUS_CODES.NOT_FOUND, description);

// Raised by service clients when a downstream microservice call fails —
// kept distinct from APIError so the handler can log which upstream broke.
const UpstreamServiceError = (service, description = 'upstream service error') =>
  BaseError(`${service}-service error`, STATUS_CODES.BAD_GATEWAY, description);

module.exports = {
  BaseError,
  APIError,
  ValidationError,
  AuthorizeError,
  ForbiddenError,
  NotFoundError,
  UpstreamServiceError,
};
