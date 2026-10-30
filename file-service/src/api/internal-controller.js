// Service-to-service API. requireInternal checks X-Internal-Token; the calling
// service passes the user context it has already verified. The gateway blocks
// /files/internal/* (and /*/internal/*), so these are unreachable from outside.
//
//   POST /internal/upload?module=&entity_id=[&category=]   multipart, same rules as the public upload
//   POST /internal/store?module=&entity_id=&file_name=[&category=]   raw body (server-generated PDFs, exports)
//   POST /internal/resolve  { file_ids }                    → URLs for responses
//   POST /internal/delete   { file_ids } | { module, entity_id }   soft delete

const express = require('express');
const validate = require('../utils/requestValidator');
const schema = require('../schema/file-schema');
const { acceptFiles } = require('../middleware/upload');
const { getModule } = require('../storage/modules');
const STATUS_CODES = require('../utils/error/status-codes');

function createInternalRouter({ files, requireInternal, limits, uploadSlots }) {
  const router = express.Router();
  router.use(requireInternal);

  const target = (req) => {
    const t = validate(schema.internalTarget, req.query);
    req.logFields = { module: t.module };
    return t;
  };
  const checkTarget = (req, _res, next) => {
    try {
      target(req);
      next();
    } catch (err) {
      next(err);
    }
  };

  router.post('/upload', checkTarget, limits.upload, uploadSlots.middleware,
    acceptFiles((req) => req.query.module), async (req, res) => {
      const { module, entity_id, category } = target(req);
      const data = await files.uploadMany(req.ctx, { module, entityId: entity_id, category, files: req.uploadedFiles });
      res.status(STATUS_CODES.CREATED).json({ success: true, data });
    });

  // Raw body, sized by the module's own limit.
  const rawBody = (req, res, next) => {
    const mod = getModule(req.query.module);
    express.raw({ type: () => true, limit: mod.maxSizeMb * 1024 * 1024 })(req, res, next);
  };
  router.post('/store', checkTarget, uploadSlots.middleware, rawBody, async (req, res) => {
    const { module, entity_id, category, file_name } = target(req);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const data = await files.uploadMany(req.ctx, {
      module, entityId: entity_id, category,
      files: [{ originalname: file_name || 'file', buffer, size: buffer.length }],
    });
    res.status(STATUS_CODES.CREATED).json({ success: true, data: data[0] });
  });

  router.post('/resolve', express.json({ limit: '16kb' }), async (req, res) => {
    const { file_ids } = validate(schema.batchUrlsBody, req.body || {});
    const rows = await files.getAuthorisedFiles(req.ctx, file_ids);
    res.json({ success: true, data: await files.urlsFor(req.ctx, rows, 'resolve') });
  });

  router.post('/delete', express.json({ limit: '16kb' }), async (req, res) => {
    const body = validate(schema.internalDeleteBody, req.body || {});
    if (body.module) {
      return res.json({
        success: true,
        data: await files.deleteEntityFiles(req.ctx, { module: body.module, entityId: body.entity_id }),
      });
    }
    const rows = await files.getAuthorisedFiles(req.ctx, body.file_ids);
    const deleted = [];
    for (const row of rows) deleted.push((await files.deleteFile(req.ctx, row)).file_id);
    res.json({ success: true, data: { deleted_count: deleted.length, file_ids: deleted } });
  });

  return router;
}

module.exports = { createInternalRouter };
