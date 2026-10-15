const { logger } = require('../logger');

const HandleErrorWithLogger = (error, req, res, next) => {
  let reportError = true;
  let status = 500;
  let data = error.message;

  // skip common / known errors. NotFoundError / ValidationError / AuthorizeError
  // are factories returning plain Errors with a 4xx `status`, so `instanceof`
  // never matched them; check the status instead.
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    reportError = false;
    status = error.status;
    data = error.message;
  }

  if (reportError) {
    // send to monitoring tool (e.g., Cloudwatch, Sentry)
    logger.error(error);
  } else {
    // common/expected errors (e.g., user mistakes)
    logger.warn(error);
  }

  return res.status(status).json({ message: data });
};

const HandleUnCaughtException = async (error) => {
  // report / monitoring tools
  logger.error(error);

  // exit process to avoid running in broken state
  process.exit(1);
};

module.exports = {
  HandleErrorWithLogger,
  HandleUnCaughtException,
};
