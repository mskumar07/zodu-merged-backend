const conn = require('../database/connection');

const COLUMNS = `file_id, zodu_id, branch_id, module, category, entity_id, object_key,
  mime_type, size_bytes, original_name, uploaded_by, status, created_at`;

// All rows of one upload in one transaction: either every file is recorded or none.
exports.insertFiles = async (rows) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
    const out = [];
    for (const r of rows) {
      const { rows: [row] } = await client.query(
        `INSERT INTO tbl_files
           (file_id, zodu_id, branch_id, module, category, entity_id, object_key,
            mime_type, size_bytes, original_name, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${COLUMNS}`,
        [r.file_id, r.zodu_id, r.branch_id, r.module, r.category, r.entity_id, r.object_key,
          r.mime_type, r.size_bytes, r.original_name, r.uploaded_by],
      );
      out.push(row);
    }
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

exports.findReady = async (file_id) => {
  const { rows } = await conn.query(
    `SELECT ${COLUMNS} FROM tbl_files WHERE file_id = $1 AND status = 'ready'`,
    [file_id],
  );
  return rows[0] || null;
};

exports.findReadyMany = async (file_ids) => {
  const { rows } = await conn.query(
    `SELECT ${COLUMNS} FROM tbl_files WHERE file_id = ANY($1::uuid[]) AND status = 'ready'`,
    [file_ids],
  );
  return rows;
};

// branch_id is null for tenant-scope modules: IS NOT DISTINCT FROM matches null too.
exports.listEntity = async ({ zodu_id, branch_id, module, entity_id }) => {
  const { rows } = await conn.query(
    `SELECT ${COLUMNS} FROM tbl_files
      WHERE zodu_id = $1 AND branch_id IS NOT DISTINCT FROM $2
        AND module = $3 AND entity_id = $4 AND status = 'ready'
      ORDER BY created_at, file_id`,
    [zodu_id, branch_id, module, entity_id],
  );
  return rows;
};

exports.softDelete = async (file_id) => {
  const { rows } = await conn.query(
    `UPDATE tbl_files SET status = 'deleted', deleted_at = now()
      WHERE file_id = $1 AND status = 'ready'
      RETURNING ${COLUMNS}`,
    [file_id],
  );
  return rows[0] || null;
};

exports.softDeleteEntity = async ({ zodu_id, branch_id, module, entity_id }) => {
  const { rows } = await conn.query(
    `UPDATE tbl_files SET status = 'deleted', deleted_at = now()
      WHERE zodu_id = $1 AND branch_id IS NOT DISTINCT FROM $2
        AND module = $3 AND entity_id = $4 AND status = 'ready'
      RETURNING ${COLUMNS}`,
    [zodu_id, branch_id, module, entity_id],
  );
  return rows;
};

exports.logAccess = async (entries) => {
  if (!entries.length) return;
  const values = [];
  const params = [];
  entries.forEach((e, i) => {
    const b = i * 5;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
    params.push(e.file_id, e.user_id || null, e.zodu_id, e.action, e.ip || null);
  });
  await conn.query(
    `INSERT INTO tbl_file_access_log (file_id, user_id, zodu_id, action, ip) VALUES ${values.join(', ')}`,
    params,
  );
};

// Purge job. Locks a batch so several replicas never remove the same objects.
// The caller removes the objects, then calls markPurged inside the same transaction.
exports.withPurgeBatch = async ({ modules, olderThanDays, limit }, fn) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT file_id, object_key FROM tbl_files
        WHERE status = 'deleted' AND purged_at IS NULL
          AND deleted_at < now() - make_interval(days => $1)
          AND module = ANY($2::text[])
        ORDER BY deleted_at
        LIMIT $3
        FOR UPDATE SKIP LOCKED`,
      [olderThanDays, modules, limit],
    );
    const purged = rows.length ? await fn(rows) : [];
    if (purged.length) {
      await client.query('UPDATE tbl_files SET purged_at = now() WHERE file_id = ANY($1::uuid[])', [purged]);
    }
    await client.query('COMMIT');
    return purged.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};
