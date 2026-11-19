const { createLogger, transports, format } = require('winston');
const morgan = require('morgan');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [new transports.Console()],
});

// Never the query string: notification cursors and SSE ids are harmless, but
// keep tokens and search text out of the logs by habit.
morgan.token('path', (req) => req.originalUrl.split('?')[0]);
morgan.token('rid', (req) => req.id || req.get('X-Request-Id') || '-');
const httpLogger = morgan(':rid :method :path :status :res[content-length] - :response-time ms', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path.startsWith('/health'),
});

module.exports = { logger, httpLogger };
