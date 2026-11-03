// Files of retail / restaurant records, through file-service. Same file in both
// services (each builds from its own folder).
//
// The apps upload first (POST /upload, /upload/multiple → a file-service link
// to a staged file) and send those links when they save the record. Saving:
//   - attachment_url arrays (expense, purchase, purchase order): the files are
//     claimed into the record — private from then on — and stored as file refs;
//     every response gets fresh URLs back from the file-url middleware.
//   - item / menu images: the link stays as stored (same file_id after a claim),
//     the file is claimed into menu-items in the background.
// If file-service can't be reached while saving, the entries are stored as
// sent: the staged links keep working, and the save never fails because of it.

const files = require('./file-client');
const { optionalAuth } = require('./access-token');

// file-service ids are [A-Za-z0-9_-]{1,64}; record ids like "PUR/24-25/001" are mapped onto that.
// No id → null (the claim is refused), never the text "undefined".
const entityKey = (id) => (id == null || id === '' ? null : String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64));

// Company/branch of a record. Edit requests may omit them: read the row then,
// unless the id is not unique on its own (ids are unique per company only).
async function tenantOf(db, { table, idColumn, id, data }) {
  if (data.zodu_id) return { zoduId: data.zodu_id, branchId: data.branch_id ?? null };
  const { rows } = await db.query(
    `SELECT zodu_id, branch_id FROM ${table} WHERE ${idColumn} = $1::varchar LIMIT 2`, [String(id)],
  );
  return rows.length === 1 ? { zoduId: rows[0].zodu_id, branchId: rows[0].branch_id } : null;
}

// The attachment_url value to store for a record (call before the INSERT/UPDATE).
async function storedAttachments(db, { table, idColumn, id, data, module }) {
  const value = data.attachment_url;
  if (!Array.isArray(value) || !value.length) return value;
  try {
    const ctx = await tenantOf(db, { table, idColumn, id, data });
    if (!ctx) return value;
    return await files.toRefs(ctx, value, { module, entityId: entityKey(id) });
  } catch (err) {
    console.warn(`[file-service] attachments of ${table} ${id} kept as sent:`, err.message);
    return value;
  }
}

// For records whose id the database generates on INSERT (purchase / expense
// ids from the trigger): insert without attachments, then call this with the
// inserted row and the attachments the client sent. Claims the files into
// <module>/<generated id>/ and stores the refs on the row; returns the row.
async function storeAfterInsert(db, { table, idColumn, row, attachments: value, module }) {
  if (!row || !Array.isArray(value) || !value.length) return row;
  const stored = await storedAttachments(db, {
    table, idColumn, id: row[idColumn], module,
    data: { zodu_id: row.zodu_id, branch_id: row.branch_id, attachment_url: value },
  });
  const { rows } = await db.query(
    `UPDATE ${table} SET attachment_url = $1 WHERE ${idColumn} = $2 AND zodu_id = $3 RETURNING *`,
    [JSON.stringify(stored), row[idColumn], row.zodu_id],
  );
  return rows[0] || row;
}

// After a record is deleted: soft-delete its stored files (accounting files
// stay in storage). Old URL entries are left alone.
async function removeStored(value) {
  for (const entry of Array.isArray(value) ? value : []) {
    if (files.refIds([entry]).length) await files.quietly(files.remove(files.ctxOfRef(entry), [entry.file_id]));
  }
}

// Background: move an item / menu image out of staging into its record.
function claimImage(row, { field, idField }) {
  if (!row?.zodu_id || !files.fileIdFromUrl(row[field])) return;
  files.quietly(files.claimUrl(
    { zoduId: row.zodu_id, branchId: row.branch_id ?? null },
    row[field],
    { module: 'menu-items', entityId: entityKey(row[idField]) },
  ));
}

// Who is uploading to /upload: the token's company if one was sent (the
// route never required it), and the client address for rate limiting.
// An invalid token is an anonymous upload, as before.
async function uploadCtx(req) {
  const auth = req.auth ?? await optionalAuth(req);
  return files.requestCtx(req, { zoduId: auth?.zoduId, userId: auth?.userId });
}

module.exports = { storedAttachments, storeAfterInsert, removeStored, claimImage, uploadCtx, entityKey };
