const pinoHttp = require('pino-http');
const pino     = require('pino');
const isDev    = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  base: { service: 'payroll-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

const httpLogger = pinoHttp({ level: 'error', logger });

module.exports = { logger, httpLogger };
