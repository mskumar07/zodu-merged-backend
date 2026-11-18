// Path ids must be UUIDs; anything else is simply "not found" (never a 500 or a 400 that hints at ids).
const { UUID } = require('../security/request');
const { notFound } = require('../utils/errors');

function uuidParams(router, ...names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => (UUID.test(String(value)) ? next() : next(notFound())));
  }
  return router;
}

module.exports = { uuidParams };
