// Public API, mounted at /files by the gateway (the gateway strips the prefix).
//
//   GET    /v/:fileId                  link modules only, no auth, cacheable
//   POST   /urls                       batch URLs (max 100), foreign ids left out
//   GET    /:fileId/url[?download=1]   presigned GET, 15 min
//   GET    /:fileId/content            stream through the API
//   DELETE /:fileId                    soft delete
//   POST   /:module/:entityId          upload (multipart "files" / "file")
//   GET    /:module/:entityId          list a record's files
//   DELETE /:module/:entityId          soft-delete a record's files
//
// /:fileId/... routes come first; a non-UUID falls through to the module routes.

const express = require('express');
const validate = require('../utils/requestValidator');
const schema = require('../schema/file-schema');
const { assertPermission, hasPermission } = require('../middleware/context');
const { acceptFiles } = require('../middleware/upload');
const STATUS_CODES = require('../utils/error/status-codes');

function createFileRouter({ files, requireUser, limits, uploadSlots }) {
  const router = express.Router();

  // ── public stable links ──────────────────────────────────────────────────
  router.get('/v/:fileId', limits.publicLinks, async (req, res) => {
    req.logFields = { fileId: req.params.fileId };
    await files.streamPublic(req.params.fileId, res);
  });

  router.use(limits.api, requireUser);

  // ── by file id ───────────────────────────────────────────────────────────
  router.post('/urls', async (req, res) => {
    const { file_ids } = validate(schema.batchUrlsBody, req.body || {});
    const rows = (await files.getAuthorisedFiles(req.ctx, file_ids))
      .filter((row) => hasPermission(req.ctx, row.module, 'read'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await files.urlsFor(req.ctx, rows, 'url') });
  });

  router.get('/:fileId/url', async (req, res, next) => {
    if (!files.isFileId(req.params.fileId)) return next('route');
    const { download } = validate(schema.downloadQuery, req.query);
    const row = await authorised(req, 'read');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: await files.getDownloadUrl(req.ctx, row, { download: download === '1' || download === 'true' }),
    });
  });

  router.get('/:fileId/content', async (req, res, next) => {
    if (!files.isFileId(req.params.fileId)) return next('route');
    const { download } = validate(schema.downloadQuery, req.query);
    const row = await authorised(req, 'read');
    res.setHeader('Cache-Control', 'private, no-store');
    await files.streamFile(req.ctx, row, res, { download: download === '1' || download === 'true' });
  });

  router.delete('/:fileId', async (req, res) => {
    const row = await authorised(req, 'delete');
    res.json({ success: true, data: await files.deleteFile(req.ctx, row) });
  });

  // ── by record ────────────────────────────────────────────────────────────
  const entity = (req) => {
    const params = validate(schema.entityParams, req.params);
    req.logFields = { module: params.module };
    return params;
  };
  const permit = (action) => (req, _res, next) => {
    try {
      const { module } = entity(req);
      assertPermission(req.ctx, module, action);
      next();
    } catch (err) {
      next(err);
    }
  };

  router.post('/:module/:entityId', permit('create'), limits.upload, uploadSlots.middleware,
    acceptFiles((req) => req.params.module), async (req, res) => {
      const { module, entityId } = entity(req);
      const { category } = validate(schema.uploadQuery, req.query);
      const data = await files.uploadMany(req.ctx, { module, entityId, category, files: req.uploadedFiles });
      res.status(STATUS_CODES.CREATED).json({ success: true, data });
    });

  router.get('/:module/:entityId', permit('read'), async (req, res) => {
    const { module, entityId } = entity(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await files.listEntityFiles(req.ctx, { module, entityId }) });
  });

  router.delete('/:module/:entityId', permit('delete'), async (req, res) => {
    const { module, entityId } = entity(req);
    res.json({ success: true, data: await files.deleteEntityFiles(req.ctx, { module, entityId }) });
  });

  // Ownership first (404), then the module permission (403): a foreign file
  // never reveals that it exists.
  async function authorised(req, action) {
    req.logFields = { fileId: req.params.fileId };
    const row = await files.getAuthorisedFile(req.ctx, req.params.fileId);
    req.logFields.module = row.module;
    assertPermission(req.ctx, row.module, action);
    return row;
  }

  return router;
}

module.exports = { createFileRouter };
