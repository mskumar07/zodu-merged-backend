// An expected failure that carries the HTTP status a handler should answer with
// (400 bad input, 403 not allowed, 404 not found, 409 conflict ...). Anything that is not one of
// these is a bug or an outage and is answered with a plain 500.
//
//   throw httpError(409, 'You already have leave on those dates');
//   throw httpError(400, 'The sheet has errors', [{ row: 3, message: '...' }]);

function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

const isHttpError = (err) => Boolean(err) && Number.isInteger(err.status) && err.status < 500;

module.exports = { httpError, isHttpError };
