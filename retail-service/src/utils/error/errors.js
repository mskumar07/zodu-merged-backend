const STATUS_CODES = require("./status-codes");

function BaseError(name, status, description) {
  const error = new Error(description);
  error.name = name;
  error.status = status;
  error.message = description;
  Error.captureStackTrace(error, BaseError);
  return error;
}

// 500 Internal Error
function APIError(description = "api error") {
  return BaseError(
    "api internal server error",
    STATUS_CODES.INTERNAL_ERROR,
    description
  );
}

// 400 Validation Error
function ValidationError(description = "bad request") {
  return BaseError("bad request", STATUS_CODES.BAD_REQUEST, description);
}

// 403 Authorize Error
function AuthorizeError(description = "access denied") {
  return BaseError("access denied", STATUS_CODES.UN_AUTHORISED, description);
}

// 404 Not Found
function NotFoundError(description = "not found") {
  return BaseError(description, STATUS_CODES.NOT_FOUND, description);
}



module.exports = {
  BaseError,
  APIError,
  ValidationError,
  AuthorizeError,
  NotFoundError,
};
