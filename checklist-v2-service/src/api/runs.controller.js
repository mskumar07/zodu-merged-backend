const express = require('express');
const security = require('../security');
const { tenantOf, callerOf, myEmployeeId } = require('../security/request');
const service = require('../services/runs');
const schema = require('../schema');
const files = require('../clients/file-client');
const { imageUpload } = require('../utils/uploads');
const { itemUpdates, photoUploads } = require('../utils/limits');
const { ah } = require('../utils/errors');
const { uuidParams } = require('./params');

const router = uuidParams(express.Router(), 'id', 'itemId', 'photoId');
security.protectParams(router);

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// Who is asking: their employee id here and what they may do.
async function ctxOf(req) {
  const caller = callerOf(req);
  return {
    userId: caller.userId,
    me: await myEmployeeId(req),
    canRead: caller.can('checklist:read'),
    canEdit: caller.can('checklist:edit'),
  };
}

const fileCtx = (req) => {
  const t = tenantOf(req);
  return files.requestCtx(req, { zoduId: t.zodu_id, branchId: t.branch_id, userId: req.auth.userId });
};

router.get('/', ah(async (req, res) => {
  const q = schema.validate(schema.listRuns, req.query, { label: 'filters' });
  const out = await service.list(tenantOf(req), q, await ctxOf(req));
  res.json({ success: true, data: out.data, pagination: out.pagination });
}));

router.get('/summary', ah(async (req, res) => {
  const q = schema.validate(schema.listRuns, req.query, { label: 'filters' });
  ok(res, await service.summary(tenantOf(req), q, await ctxOf(req)));
}));

router.get('/review-queue', ah(async (req, res) => ok(res, await service.reviewQueue(tenantOf(req), await myEmployeeId(req)))));

router.get('/:id', ah(async (req, res) => ok(res, await service.detail(tenantOf(req), req.params.id, await ctxOf(req)))));

router.put('/:id/items/:itemId', itemUpdates, ah(async (req, res) => {
  const body = schema.validate(schema.updateItem, req.body, { label: 'item' });
  ok(res, await service.updateItem(tenantOf(req), req.params.id, req.params.itemId, body, await ctxOf(req)));
}));

router.post('/:id/items/:itemId/photos', photoUploads, imageUpload({ maxFiles: 5 }), security.tenantBody, ah(async (req, res) => {
  ok(res, await service.addPhotos(tenantOf(req), req.params.id, req.params.itemId, req.files || [], await ctxOf(req), fileCtx(req)), 201);
}));

router.delete('/:id/items/:itemId/photos/:photoId', ah(async (req, res) => {
  ok(res, await service.removePhoto(tenantOf(req), req.params.id, req.params.itemId, req.params.photoId, await ctxOf(req), fileCtx(req)));
}));

router.post('/:id/complete-all', ah(async (req, res) => {
  const { row_version: v } = schema.validate(schema.versioned, req.body);
  ok(res, await service.completeAll(tenantOf(req), req.params.id, v, await ctxOf(req)));
}));

router.post('/:id/submit', ah(async (req, res) => {
  const { row_version: v } = schema.validate(schema.versioned, req.body);
  ok(res, await service.submit(tenantOf(req), req.params.id, v, await ctxOf(req)));
}));

router.post('/:id/review', ah(async (req, res) => {
  const body = schema.validate(schema.review, req.body, { label: 'review' });
  ok(res, await service.review(tenantOf(req), req.params.id, body, await ctxOf(req)));
}));

router.post('/:id/reassign', ah(async (req, res) => {
  const body = schema.validate(schema.reassign, req.body, { label: 'reassign' });
  ok(res, await service.reassign(tenantOf(req), req.params.id, body, await ctxOf(req)));
}));

module.exports = router;
