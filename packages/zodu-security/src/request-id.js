// X-Request-Id: taken from the caller when it is well-formed (the gateway sets
// it for every request), generated otherwise. Echoed in the response, set on
// req.id for the logger, and kept in AsyncLocalStorage so internal calls made
// while handling the request carry it on (internalHeaders()).

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();
const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

function requestId() {
  return function assignRequestId(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && VALID.test(incoming) ? incoming : crypto.randomUUID();
    req.id = id;
    req.headers['x-request-id'] = id;   // forwarded as-is by proxies
    res.setHeader('X-Request-Id', id);
    storage.run({ requestId: id }, next);
  };
}

const currentRequestId = () => storage.getStore()?.requestId;

module.exports = { requestId, currentRequestId };
