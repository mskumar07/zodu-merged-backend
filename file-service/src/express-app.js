const express = require('express');
const { httpLogger } = require('./utils/logger');
const { HandleErrorWithLogger } = require('./utils/error/handler');
const { NotFoundError } = require('./utils/error/errors');
const { rateLimit } = require('./middleware/rate-limit');
const { createContext, createRequireInternal } = require('./middleware/context');
const { createUploadSlots } = require('./middleware/upload');
const { createFileService } = require('./services/file-service');
const { createFileRouter } = require('./api/file-controller');
const { createInternalRouter } = require('./api/internal-controller');
const { createLegacyRouter } = require('./api/legacy-controller');

// deps: { config, repo, storage, authClient, tokenVerifier, rateLimitStore }. Built
// in server.js from the real database / MinIO / Redis / JWKS; tests pass fakes.
function createApp({
  config, repo, storage, authClient, tokenVerifier, rateLimitStore,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(httpLogger);

  // Hardening headers on every response.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });

  // Browsers normally come through the gateway (which does CORS); this is only
  // for origins explicitly listed in CORS_ORIGINS.
  if (config.CORS_ORIGINS.length) {
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && config.CORS_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After, RateLimit-Remaining, X-Request-Id');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
      }
      next();
    });
  }

  app.use(express.json({ limit: '16kb' }));

  const limit = (opts) => rateLimit({ store: rateLimitStore, windowMs: 60_000, ...opts });
  const limits = {
    // Per client IP across the whole API.
    api: limit({ name: 'API', max: 300, key: (req) => req.ip }),
    // Per user: 30 upload requests a minute (up to 300 files). Internal calls
    // without a user (old anonymous /upload) count per end-user address.
    upload: limit({
      name: 'upload', max: 30,
      key: (req) => `${req.ctx.zoduId || '-'}:${req.ctx.userId || (req.ctx.internal ? `ip:${req.ctx.ip}` : '-')}`,
    }),
    // Stable links are cached by browsers and proxies, so this one is generous.
    publicLinks: limit({ name: 'link', max: 3000, key: (req) => req.ip }),
  };
  const uploadSlots = createUploadSlots({
    max: config.MAX_CONCURRENT_UPLOADS, timeoutMs: config.UPLOAD_QUEUE_TIMEOUT_MS,
  });

  const files = createFileService({ repo, storage, config });
  const { requireUser } = createContext({ verifier: tokenVerifier, authClient });
  const requireInternal = createRequireInternal(config.INTERNAL_TOKENS);

  app.get('/health', (_req, res) => res.json({ success: true, status: 'ok' }));
  app.use('/internal', createInternalRouter({ files, requireInternal, limits, uploadSlots }));
  if (config.LEGACY_BUCKET_NAME) {
    app.use('/legacy', createLegacyRouter({
      storage, legacyBucket: config.LEGACY_BUCKET_NAME, limits, frameAncestors: config.FRAME_ANCESTORS,
    }));
  }
  app.use('/', createFileRouter({ files, requireUser, limits, uploadSlots }));

  app.use((_req, _res, next) => next(NotFoundError('Not found')));
  app.use(HandleErrorWithLogger);
  return app;
}

module.exports = { createApp };
