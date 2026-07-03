const { logger } = require('../logger');

const HandleErrorWithLogger = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });
  return res.status(err.status || 500).json({ success: false, error: err.message });
};

module.exports = { HandleErrorWithLogger };
