// Wraps an async route handler so rejected promises reach HandleErrorWithLogger
// instead of hanging the request. Keeps controllers free of repetitive try/catch.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
