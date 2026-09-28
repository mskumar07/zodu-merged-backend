const { logger } = require('../logger');

const HandleErrorWithLogger = (error, req, res, next) => {
  const status = error.status || 500;
  const message = error.message || 'Internal server error';

  logger.error({ err: error, path: req.originalUrl }, message);

  return res.status(status).json({ success: false, error: message });
};

const HandleUnCaughtException = async (error) => {
  logger.error(error);
  process.exit(1);
};

module.exports = { HandleErrorWithLogger, HandleUnCaughtException };
