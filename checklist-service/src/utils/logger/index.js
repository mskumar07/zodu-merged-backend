const { createLogger, transports, format } = require('winston');
const morgan = require('morgan');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [new transports.Console()],
});

const httpLogger = morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
});

module.exports = { logger, httpLogger };
