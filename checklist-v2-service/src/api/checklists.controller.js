const express = require('express');
const security = require('../security');
const { tenantOf, callerOf, scopeOf } = require('../security/request');
const service = require('../services/checklists');
const schema = require('../schema');
const files = require('../clients/file-client');
const { idempotent } = require('../utils/idempotency');
const { documentUpload } = require('../utils/uploads');
const { photoUploads } = require('../utils/limits');
const { ah } = require('../utils/errors');
const { uuidParams } = require('./params');

const router = uuidParams(express.Router(), 'id', 'imageId');
security.protectParams(router);

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// The caller and their team (who they may assign and manage).
const actorOf = async (req) => ({ ...callerOf(req), scope: await scopeOf(req) });

router.get('/', ah(async (req, res) => {
  const q = schema.validate(schema.listChecklists, req.query, { label: 'filters' });
  const out = await service.list(tenantOf(req), q);
  res.json({ success: true, data: out.data, pagination: out.pagination });
}));

router.post('/', ah(async (req, res) => {
  const body = schema.validate(schema.createChecklist, req.body, { label: 'checklist' });
  await idempotent(req, res, async () => ({
    status: 201,
    body: { success: true, data: await service.create(tenantOf(req), await actorOf(req), body) },
  }));
}));

// Who the caller may assign: everyone (Admin) or their team. Before '/:id'.
router.get('/people', ah(async (req, res) => {
  const out = await service.people(tenantOf(req), await scopeOf(req));
  res.json({ success: true, scope: out.scope, data: out.data });
}));

router.post('/schedule-preview', ah(async (req, res) => {
  const body = schema.validate(schema.schedulePreview, req.body, { label: 'preview' });
  ok(res, await service.schedulePreview(tenantOf(req), body));
}));

// Reference files for tasks: stored now, put on tasks when the checklist is saved.
router.post('/task-files', photoUploads, documentUpload({ maxFiles: 5 }), security.tenantBody, ah(async (req, res) => {
  const tenant = tenantOf(req);
  const ctx = files.requestCtx(req, { zoduId: tenant.zodu_id, branchId: tenant.branch_id, userId: req.auth.userId });
  ok(res, await service.addTaskFiles(tenant, callerOf(req), req.files || [], ctx), 201);
}));

router.get('/:id', ah(async (req, res) => ok(res, await service.getDefinition(tenantOf(req), req.params.id))));

router.put('/:id', ah(async (req, res) => {
  const body = schema.validate(schema.updateChecklist, req.body, { label: 'checklist' });
  ok(res, await service.update(tenantOf(req), await actorOf(req), req.params.id, body));
}));

router.patch('/:id/status', ah(async (req, res) => {
  const { status } = schema.validate(schema.checklistStatus, req.body, { label: 'status' });
  ok(res, await service.setStatus(tenantOf(req), await actorOf(req), req.params.id, status));
}));

router.post('/:id/duplicate', ah(async (req, res) => {
  await idempotent(req, res, async () => ({
    status: 201,
    body: { success: true, data: await service.duplicate(tenantOf(req), await actorOf(req), req.params.id) },
  }));
}));

router.delete('/:id', ah(async (req, res) => {
  await service.remove(tenantOf(req), await actorOf(req), req.params.id);
  res.status(204).end();
}));

// Checklist attachments: photos, PDF, Word or Excel (the route keeps its old name).
router.post('/:id/images', photoUploads, documentUpload({ maxFiles: 6 }), security.tenantBody, ah(async (req, res) => {
  const tenant = tenantOf(req);
  const ctx = files.requestCtx(req, { zoduId: tenant.zodu_id, branchId: tenant.branch_id, userId: req.auth.userId });
  ok(res, await service.addImages(tenant, callerOf(req), req.params.id, req.files || [], ctx), 201);
}));

router.delete('/:id/images/:imageId', ah(async (req, res) => {
  const tenant = tenantOf(req);
  const ctx = files.requestCtx(req, { zoduId: tenant.zodu_id, branchId: tenant.branch_id, userId: req.auth.userId });
  await service.removeImage(tenant, req.params.id, req.params.imageId, ctx);
  res.status(204).end();
}));

module.exports = router;
