const { logger } = require('../logger');

const HandleErrorWithLogger = (error, req, res, next) => {
  let status = error.status || 500;
  let data   = error.message || 'Internal server error';

  logger.error(error);

  return res.status(status).json({ success: false, error: data });
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
