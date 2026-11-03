const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');

const env = process.env.NODE_ENV;
const isDev = env !== 'production' && env !== 'test';

// Never log file contents or credentials.
const REDACT = [
  'req.headers.authorization',
  'req.headers["x-internal-token"]',
  'req.headers.cookie',
];

const logger = pino({
  level: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : isDev ? 'debug' : 'info'),
  base: { service: 'file-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT, censor: '[redacted]' },
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

// One structured line per request: request id, user, tenant, module, file.
const httpLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customProps: (req) => ({
    userId: req.ctx?.userId,
    zoduId: req.ctx?.zoduId,
    branchId: req.ctx?.branchId,
    caller: req.ctx?.caller,
    module: req.logFields?.module,
    fileId: req.logFields?.fileId,
  }),
  serializers: {
    // Method and path only: query strings may carry signatures.
    req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    return res.statusCode >= 400 ? 'warn' : 'info';
  },
  autoLogging: { ignore: (req) => req.url === '/health' },
});

module.exports = { logger, httpLogger };
