// The HTTP app (ROLE=api). Order: security headers → /health → /internal
// (auth-service token) → customer routes (access token, tenant, route policy).
const express = require('express');
const { requireInternal, applySecurity } = require('@zodu/security');
const pool = require('./database/pool');
const listener = require('./database/listener');
const security = require('./security');
const { httpLogger } = require('./utils/logger');
const { errorHandler, notFound } = require('./utils/errors');
const { fileUrlsMiddleware } = require('./clients/file-client');
const { SseHub } = require('./realtime/sse-hub');
const { notificationsRouter, preferences } = require('./api/notifications.controller');
const { categories, dashboards, settings, taskStatuses } = require('./api/misc.controllers');

function createApiApp({ hub = new SseHub() } = {}) {
  const app = express();
  applySecurity(app, { express, cors: false, ipLimitPerMinute: 0, bodyLimit: '1mb' });
  app.use(httpLogger);

  // Liveness: the process answers. Readiness: DB and the LISTEN connection.
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      if (!listener.connected) return res.status(503).json({ status: 'listener down' });
      return res.json({ status: 'ok', sse_streams: hub.size });
    } catch {
      return res.status(503).json({ status: 'db down' });
    }
  });

  app.use('/internal', requireInternal('auth'), require('./api/internal.controller'));

  app.use(security.middleware);
  // Stored file refs → fresh file-service URLs in every JSON response.
  app.use(fileUrlsMiddleware);

  app.use('/api/categories', categories);
  app.use('/api/settings', settings);
  app.use('/api/task-statuses', taskStatuses);
  app.use('/api/checklists', require('./api/checklists.controller'));
  app.use('/api/runs', require('./api/runs.controller'));
  app.use('/api/dashboard', dashboards);
  app.use('/api/notifications', notificationsRouter(hub));
  app.use('/api/notification-preferences', preferences);

  app.use((req, res, next) => next(notFound()));
  app.use(errorHandler);
  app.locals.hub = hub;
  return app;
}

module.exports = { createApiApp };
