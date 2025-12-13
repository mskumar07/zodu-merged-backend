const { AuthorizeError, NotFoundError, ValidationError } = require('./errors');
const { logger } = require('../logger');

const HandleErrorWithLogger = (error, req, res, next) => {
  let reportError = true;
  let status = 500;
  let data = error.message;

  // skip common / known errors
  [NotFoundError, ValidationError, AuthorizeError].forEach((typeOfError) => {
    if (error instanceof typeOfError) {
      reportError = false;
      status = error.status;
      data = error.message;
    }
  });

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
