// GET /legacy/<key> — files stored before file-service, still referenced by full
// URLs in the services' tables (PUBLIC_FILE_BASE_URL/{service}/file/<key>). The
// gateway sends /auth|employee|restaurant|retail|checklist/file/* here, so the
// services no longer need MinIO credentials. Read-only, from the old bucket.
//
// Same exposure as the old unauthenticated /file/:name routes, with their
// caching (a key never changes once written: one-year immutable cache, ETag,
// 304 on revalidation), plus nosniff / sandbox headers they lacked.
//
// Phase 3 replaces this with tbl_files.legacy_url lookups and the link/private
// rules, once the objects are migrated into the new bucket.

const express = require('express');
const mime = require('mime-types');
const { contentDisposition } = require('../services/file-service');
const { NotFoundError } = require('../utils/error/errors');
const { fileResponseHeaders } = require('../utils/file-headers');

const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
// Never let an old object render as a page in our origin.
const SCRIPTABLE = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/;

function createLegacyRouter({ storage, legacyBucket, limits, frameAncestors = [] }) {
  const router = express.Router();

  router.get('/*key', limits.publicLinks, async (req, res) => {
    const key = [].concat(req.params.key).join('/');
    if (!key || key.length > 1024 || key.includes('..') || key.startsWith('/')) throw NotFoundError();

    let stat;
    try {
      stat = await storage.internal.statObject(legacyBucket, key);
    } catch (err) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') throw NotFoundError();
      throw err;
    }

    const etag = `"${stat.etag}"`;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(stat.lastModified).toUTCString());
    if (req.get('If-None-Match') === etag) return res.status(304).end();

    let type = mime.lookup(key) || 'application/octet-stream';
    if (SCRIPTABLE.test(type)) type = 'application/octet-stream';
    const name = key.split('/').pop();

    const stream = await storage.internal.getObject(legacyBucket, key);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', contentDisposition(type, safeName(name), !INLINE.has(type)));
    fileResponseHeaders(res, type, frameAncestors);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  return router;
}

const safeName = (name) => {
  try {
    return decodeURIComponent(name).replace(/[\u0000-\u001f\u007f"\\]/g, '') || 'file';
  } catch {
    return name.replace(/[\u0000-\u001f\u007f"\\]/g, '') || 'file';
  }
};

module.exports = { createLegacyRouter };
