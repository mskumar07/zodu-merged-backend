const express = require('express');
const { tenantOf } = require('../security/request');
const service = require('../services/notifications');
const schema = require('../schema');
const { ah, AppError } = require('../utils/errors');
const { uuidParams } = require('./params');

// A stream must outlive its token by at least this long to be worth opening.
const MIN_STREAM_LIFETIME_MS = 15_000;

// hub: the instance's SseHub (api-app.js).
function notificationsRouter(hub) {
  const router = uuidParams(express.Router(), 'id');

  router.get('/', ah(async (req, res) => {
    const q = schema.validate(schema.listNotifications, req.query, { label: 'filters' });
    const out = await service.list(tenantOf(req), req.auth.userId, q);
    res.json({ success: true, data: out.data, pagination: out.pagination });
  }));

  router.get('/unread-count', ah(async (req, res) => {
    res.json({ success: true, data: { count: await service.unreadCount(tenantOf(req), req.auth.userId) } });
  }));

  router.post('/read-all', ah(async (req, res) => {
    const { before } = schema.validate(schema.readAll, req.body);
    await service.markAllRead(tenantOf(req), req.auth.userId, before);
    res.status(204).end();
  }));

  router.post('/:id/read', ah(async (req, res) => {
    await service.markRead(tenantOf(req), req.auth.userId, req.params.id);
    res.status(204).end();
  }));

  // SSE (§7.2). Replays what was missed (Last-Event-ID), then the unread count.
  router.get('/stream', ah(async (req, res) => {
    // A token past (or about to reach) exp is still accepted for the clock
    // tolerance, but its stream would get `reauth` at once, and a client that
    // reconnects with the same token would loop. Make it refresh first.
    const { expiresAt } = req.auth;
    if (expiresAt && expiresAt * 1000 - Date.now() < MIN_STREAM_LIFETIME_MS) {
      throw new AppError(401, 'Access token is about to expire; refresh it and reconnect', 'TOKEN_EXPIRING');
    }
    const tenant = tenantOf(req);
    const userId = req.auth.userId;
    const lastEventId = req.get('Last-Event-ID');
    const [missed, count] = await Promise.all([
      lastEventId ? service.since(tenant, userId, lastEventId) : [],
      service.unreadCount(tenant, userId),
    ]);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    const stream = hub.add({ res, userId, zoduId: tenant.zodu_id, branchId: tenant.branch_id, expiresAt: req.auth.expiresAt });
    hub.write(stream, 'retry: 3000\n\n');
    for (const row of missed) hub.sendNotification(stream, row);
    hub.sendUnread(stream, count);
  }));

  return router;
}

const preferences = express.Router();
preferences.get('/', ah(async (req, res) => {
  res.json({ success: true, data: await service.getPreferences(tenantOf(req), req.auth.userId) });
}));
preferences.put('/', ah(async (req, res) => {
  const body = schema.validate(schema.preferences, req.body, { label: 'preferences' });
  res.json({ success: true, data: await service.putPreferences(tenantOf(req), req.auth.userId, body) });
}));

module.exports = { notificationsRouter, preferences };
