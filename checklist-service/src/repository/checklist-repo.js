const db = require('../database/connection');

// ── CREATE ────────────────────────────────────────────────────────────────────

// Next sequential code per zodu_id, e.g. CHECKLIST-001
// uq_checklists_zodu_code guards against a duplicate slipping through on concurrent inserts.
exports.generateChecklistCode = async (client, zodu_id) => {
  const { rows } = await client.query(
    `SELECT MAX(CAST(NULLIF(REGEXP_REPLACE(checklist_code, '[^0-9]', '', 'g'), '') AS INTEGER)) AS max_num
     FROM tbl_checklists
     WHERE zodu_id = $1`,
    [zodu_id]
  );
  const next = (rows[0].max_num || 0) + 1;
  return `CHECKLIST-${String(next).padStart(3, '0')}`;
};

exports.insertChecklist = async (client, d) => {
  console.log('Inserting checklist into DB with data:', d);
  const checklist_code = await exports.generateChecklistCode(client, d.zodu_id);

  const { rows } = await client.query(
    `INSERT INTO tbl_checklists (
       checklist_code, zodu_id, branch_id, title, description, status,
       due_date, start_date,
       is_recurring, recur_frequency, recur_every,
       recur_ends, recur_end_date, recur_start_date,
       created_by, created_by_name
     ) VALUES (
       $1,$2,$3,$4,$5,$6,
       $7,$8,
       $9,$10,$11,
       $12,$13,$14,
       $15,$16
     ) RETURNING *`,
    [
      checklist_code, d.zodu_id, d.branch_id, d.title, d.description || null, d.status,
      d.due_date || null, d.start_date || null,
      d.is_recurring || false, d.recur_frequency || null, d.recur_every || null,
      d.recur_ends || null, d.recur_end_date || null, d.recur_start_date || null,
      d.created_by, d.created_by_name,
    ]
  );
  return rows[0];
};

exports.insertAssignees = async (client, checklist_id, assignees) => {
  if (!assignees?.length) return [];
  const placeholders = assignees.map((a, i) =>
    `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
  ).join(', ');
  const flat = assignees.flatMap(a => [checklist_id, a.employee_id, a.employee_name]);

  const { rows } = await client.query(
    `INSERT INTO tbl_checklist_assignees (checklist_id, employee_id, employee_name)
     VALUES ${placeholders}
     ON CONFLICT (checklist_id, employee_id) DO NOTHING
     RETURNING *`,
    flat
  );
  return rows;
};

//   - Insert assignees without id (new ones)
//   - Delete assignees whose id is NOT in the sent list (removed by user)
//   - Existing assignees (have id) are left untouched
exports.upsertAssignees = async (client, checklist_id, assignees) => {
  // Remove assignees that were dropped — those with id not in the sent list
  const keptIds = assignees.filter(a => a.id).map(a => a.id);
  if (keptIds.length) {
    await client.query(
      `DELETE FROM tbl_checklist_assignees
       WHERE checklist_id = $1 AND id <> ALL($2::uuid[])`,
      [checklist_id, keptIds]
    );
  } else {
    // All existing assignees were removed
    await client.query(
      `DELETE FROM tbl_checklist_assignees WHERE checklist_id = $1`,
      [checklist_id]
    );
  }
  // Insert new ones (no id)
  const newOnes = assignees.filter(a => !a.id);
  if (newOnes.length) {
    const placeholders = newOnes.map((a, i) =>
      `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`
    ).join(', ');
    const flat = newOnes.flatMap(a => [checklist_id, a.employee_id, a.employee_name]);

    await client.query(
      `INSERT INTO tbl_checklist_assignees (checklist_id, employee_id, employee_name)
       VALUES ${placeholders}
       ON CONFLICT (checklist_id, employee_id) DO NOTHING`,
      flat
    );
  }

  const { rows } = await client.query(
    `SELECT * FROM tbl_checklist_assignees WHERE checklist_id = $1 ORDER BY assigned_at`,
    [checklist_id]
  );
  return rows;
};

// Upsert items on PUT /:id — updates existing rows by id, inserts new ones.
// Preserves status/remarks/file_url/employee_checklist_upload on existing rows.
exports.upsertItems = async (client, checklist_id, items) => {
  const results = [];
  for (const it of items) {
    if (it.id) {
      // existing item — update only editable fields, preserve status/remarks/files
      const { rows } = await client.query(
        `UPDATE tbl_checklist_items
         SET item_order  = $1,
             item_title  = $2,
             description = $3,
             file_url = $6,
             updated_at  = NOW()
         WHERE id = $4 AND checklist_id = $5
         RETURNING *`,
        [it.item_order, it.item_title, it.description || null, it.id, checklist_id, JSON.stringify(it.file_url || [])]
      );
      if (rows[0]) results.push(rows[0]);
    } else {
      // new item — insert fresh
      const { rows } = await client.query(
        `INSERT INTO tbl_checklist_items
           (checklist_id, item_order, item_title, description, file_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [checklist_id, it.item_order, it.item_title, it.description || null, JSON.stringify(it.file_url || [])]
      );
      if (rows[0]) results.push(rows[0]);
    }
  }
  return results;
};

exports.insertItems = async (client, checklist_id, items) => {
  if (!items?.length) return [];
  const placeholders = items.map((_, i) =>
    `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
  ).join(', ');
  const flat = items.flatMap(it => [
    checklist_id,
    it.item_order,
    it.item_title,
    it.description || null,
    JSON.stringify(it.file_url || []),   // JSONB array — admin pre-uploads
  ]);
  const { rows } = await client.query(
    `INSERT INTO tbl_checklist_items
       (checklist_id, item_order, item_title, description, file_url)
     VALUES ${placeholders} RETURNING *`,
    flat
  );
  return rows;
};

// Append one or more file objects into the JSONB array of an item (one UPDATE)
// Used when admin or employee uploads file(s) after task creation
exports.appendFileToItem = async (item_id, fileObjs) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_items
     SET file_url   = file_url || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(Array.isArray(fileObjs) ? fileObjs : [fileObjs]), item_id]
  );
  return rows[0] || null;
};

exports.appendEmployeeFileToItem = async (item_id, fileObjs) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_items
     SET employee_checklist_upload = COALESCE(employee_checklist_upload, '[]'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(Array.isArray(fileObjs) ? fileObjs : [fileObjs]), item_id]
  );
  return rows[0] || null;
};

// Remove one file object from the file_url JSONB array by its id field
exports.removeFileFromItem = async (item_id, file_id) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_items
     SET file_url   = (
       SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
       FROM jsonb_array_elements(file_url) f
       WHERE f->>'id' <> $1
     ),
     updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [file_id, item_id]
  );
  return rows[0] || null;
};

// Remove one file object from the employee_checklist_upload JSONB array by its id field
exports.removeEmployeeFileFromItem = async (item_id, file_id) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_items
     SET employee_checklist_upload = (
       SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(employee_checklist_upload, '[]'::jsonb)) f
       WHERE f->>'id' <> $1
     ),
     updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [file_id, item_id]
  );
  return rows[0] || null;
};

// Update one item's shared status + remarks (any assignee can call this)
exports.updateItemStatus = async (item_id, { status, remarks, employee_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_items
     SET status      = $1,
         remarks     = $2,
         employee_id = $3,
         updated_at  = NOW()
     WHERE id = $4
     RETURNING *`,
    [status, remarks ?? null, employee_id ?? null, item_id]
  );
  return rows[0] || null;
};

// One row PER CHECKLIST — file_url is a JSONB array of { id, file_name, file_url,
// uploaded_by, uploaded_by_name }. New uploads APPEND to the existing row's array;
// only creates a new row the first time a checklist gets an attachment.
exports.insertAttachments = async (client, { checklist_id, files, uploaded_by, uploaded_by_name }) => {
  const { v4: uuidv4 } = require('uuid');

  const newEntries = files.map(f => ({
    id:               uuidv4(),
    file_name:        f.fileName,
    file_url:         f.fileUrl,
    uploaded_by,
    uploaded_by_name,
  }));

  const { rows } = await client.query(
    `INSERT INTO tbl_checklist_attachments (checklist_id, file_url, uploaded_by, uploaded_by_name)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (checklist_id) DO UPDATE
       SET file_url   = tbl_checklist_attachments.file_url || EXCLUDED.file_url,
           uploaded_by      = EXCLUDED.uploaded_by,
           uploaded_by_name = EXCLUDED.uploaded_by_name,
           uploaded_at      = NOW()
     RETURNING *`,
    [checklist_id, JSON.stringify(newEntries), uploaded_by, uploaded_by_name]
  );
  return rows[0];
};

// Updates specific file entries WITHIN the checklist's single file_url array,
// matched by each entry's own id. Entries with no matching id are left as-is.
// attachments = [{ id, file_name, file_url }, ...]
exports.updateAttachments = async (client, checklist_id, attachments) => {

  const { rows: updated } = await client.query(
    `UPDATE tbl_checklist_attachments
     SET file_url = $1::jsonb, uploaded_at = NOW()
     WHERE checklist_id = $2
     RETURNING *`,
    [JSON.stringify(attachments), checklist_id]
  );
  return updated[0];
};

// ── LIST ──────────────────────────────────────────────────────────────────────

exports.findAll = async ({ zodu_id, branch_id, status, search, limit, offset }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (status) { conds.push(`c.status = $${idx++}`); vals.push(status); }
  if (search) {
    conds.push(`c.title ILIKE $${idx++}`);
    vals.push(`%${search}%`);
  }

  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT
       c.id, c.checklist_code, c.title, c.description, c.status,
       TO_CHAR(c.due_date,   'YYYY-MM-DD') AS due_date,
       TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
       c.is_recurring, c.recur_frequency, c.recur_every,
       c.recur_ends,
       TO_CHAR(c.recur_end_date,   'YYYY-MM-DD') AS recur_end_date,
       TO_CHAR(c.recur_start_date, 'YYYY-MM-DD') AS recur_start_date,
       c.created_by_name, c.created_at,
       COUNT(DISTINCT ca.employee_id)::int  AS total_assignees,
       COUNT(DISTINCT ci.id)::int           AS total_items
     FROM tbl_checklists c
     LEFT JOIN tbl_checklist_assignees ca ON ca.checklist_id = c.id
     LEFT JOIN tbl_checklist_items     ci ON ci.checklist_id = c.id
     WHERE ${conds.join(' AND ')}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};

exports.countAll = async ({ zodu_id, branch_id, status, search }) => {
  const conds = ['zodu_id = $1', 'branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (status) { conds.push(`status = $${idx++}`); vals.push(status); }
  if (search) { conds.push(`title ILIKE $${idx++}`); vals.push(`%${search}%`); }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM tbl_checklists WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0].total;
};

// ── DETAIL ────────────────────────────────────────────────────────────────────

exports.findById = async (id, { zodu_id, branch_id }) => {
  const { rows } = await db.query(
    `SELECT *,
       TO_CHAR(due_date,         'YYYY-MM-DD') AS due_date,
       TO_CHAR(start_date,       'YYYY-MM-DD') AS start_date,
       TO_CHAR(recur_end_date,   'YYYY-MM-DD') AS recur_end_date,
       TO_CHAR(recur_start_date, 'YYYY-MM-DD') AS recur_start_date
     FROM tbl_checklists
     WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

exports.findAssignees = async (checklist_id) => {
  const { rows } = await db.query(
    `SELECT * FROM tbl_checklist_assignees WHERE checklist_id = $1 ORDER BY assigned_at`,
    [checklist_id]
  );
  return rows;
};

exports.findItems = async (checklist_id) => {
  const { rows } = await db.query(
    `SELECT * FROM tbl_checklist_items WHERE checklist_id = $1 ORDER BY item_order`,
    [checklist_id]
  );
  return rows;
};

// Returns the flat array of files for this checklist (file_url is the JSONB
// array column) — empty array if no attachments row exists yet.
exports.findAttachments = async (checklist_id) => {
  const { rows } = await db.query(
    `SELECT file_url FROM tbl_checklist_attachments WHERE checklist_id = $1`,
    [checklist_id]
  );
  return rows[0]?.file_url || [];
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

const UPDATABLE = [
  'title', 'description', 'status', 'due_date', 'start_date',
  'is_recurring', 'recur_frequency', 'recur_every',
  'recur_ends', 'recur_end_date', 'recur_start_date',
  'updated_by', 'updated_by_name',
];

exports.updateChecklist = async (client, id, fields, { zodu_id, branch_id }) => {
  const sets = [];
  const vals = [];
  let   idx  = 1;

  for (const key of UPDATABLE) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  vals.push(id, zodu_id, branch_id);

  const { rows } = await client.query(
    `UPDATE tbl_checklists SET ${sets.join(', ')}
     WHERE id = $${idx++} AND zodu_id = $${idx++} AND branch_id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
};

exports.deleteAssignees = async (client, checklist_id) => {
  await client.query(
    `DELETE FROM tbl_checklist_assignees WHERE checklist_id = $1`, [checklist_id]
  );
};

exports.deleteItems = async (client, checklist_id) => {
  await client.query(
    `DELETE FROM tbl_checklist_items WHERE checklist_id = $1`, [checklist_id]
  );
};

exports.deleteItem = async (item_id) => {
  const { rows, rowCount } = await db.query(
    `DELETE FROM tbl_checklist_items WHERE id = $1 RETURNING checklist_id`, [item_id]
  );
  return rowCount > 0 ? rows[0].checklist_id : null;
};

exports.updateChecklistStatus = async (checklist_id, status) => {
  await db.query(
    `UPDATE tbl_checklists SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, checklist_id]
  );
};

// ── DELETE ────────────────────────────────────────────────────────────────────

exports.deleteChecklist = async (id, { zodu_id, branch_id }) => {
  const { rowCount } = await db.query(
    `DELETE FROM tbl_checklists WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rowCount > 0;
};

// Removes one file entry (by its id within the array) from the checklist's file_url array
exports.deleteAttachment = async (file_id, checklist_id) => {
  const { rows } = await db.query(
    `UPDATE tbl_checklist_attachments
     SET file_url = (
       SELECT jsonb_agg(f)
       FROM jsonb_array_elements(file_url) f
       WHERE f->>'id' <> $1
     ),
     uploaded_at = NOW()
     WHERE checklist_id = $2
     RETURNING file_url`,
    [file_id, checklist_id]
  );
  return rows[0] || null;
};

// ── INSTANCES ─────────────────────────────────────────────────────────────────

exports.findInstances = async ({ checklist_id, zodu_id, branch_id, status, limit, offset }) => {
  const conds = ['ci.zodu_id = $1', 'ci.branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (checklist_id) { conds.push(`ci.checklist_id = $${idx++}`); vals.push(checklist_id); }
  if (status)       { conds.push(`ci.status = $${idx++}`);       vals.push(status); }

  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT
       ci.id, ci.checklist_id, ci.scheduled_date, ci.status,
       c.title,
       COUNT(p.id) FILTER (WHERE p.is_completed = TRUE)::int  AS completed_items,
       COUNT(p.id)::int                                        AS total_items
     FROM tbl_checklist_instances ci
     JOIN tbl_checklists c         ON c.id = ci.checklist_id
     LEFT JOIN tbl_checklist_item_progress p ON p.instance_id = ci.id
     WHERE ${conds.join(' AND ')}
     GROUP BY ci.id, c.title
     ORDER BY ci.scheduled_date DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};

exports.countInstances = async ({ checklist_id, zodu_id, branch_id, status }) => {
  const conds = ['zodu_id = $1', 'branch_id = $2'];
  const vals  = [zodu_id, branch_id];
  let   idx   = 3;

  if (checklist_id) { conds.push(`checklist_id = $${idx++}`); vals.push(checklist_id); }
  if (status)       { conds.push(`status = $${idx++}`);       vals.push(status); }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM tbl_checklist_instances WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0].total;
};

// ── ITEM PROGRESS ─────────────────────────────────────────────────────────────

exports.upsertItemProgress = async (d) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_checklist_item_progress
       (instance_id, item_id, employee_id, is_completed, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (instance_id, item_id, employee_id)
     DO UPDATE SET
       is_completed = EXCLUDED.is_completed,
       completed_at = EXCLUDED.completed_at,
       updated_at   = NOW()
     RETURNING *`,
    [
      d.instance_id, d.item_id, d.employee_id,
      d.is_completed,
      d.is_completed ? new Date() : null,
    ]
  );
  return rows[0];
};

exports.getInstanceProgress = async (instance_id, employee_id) => {
  const { rows } = await db.query(
    `SELECT
       p.item_id, p.is_completed, p.completed_at,
       i.item_title, i.item_order
     FROM tbl_checklist_item_progress p
     JOIN tbl_checklist_items i ON i.id = p.item_id
     WHERE p.instance_id = $1 AND p.employee_id = $2
     ORDER BY i.item_order`,
    [instance_id, employee_id]
  );
  return rows;
};

// ── MY TASK SUMMARY (top table — summary card for logged-in employee) ──────────
// Filter: only checklists where employee_id is in tbl_checklist_assignees
exports.getMyTaskSummary = async ({ zodu_id, branch_id, employee_id, search, status }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'ca.employee_id = $3'];
  const vals  = [zodu_id, branch_id, employee_id];
  let   idx   = 4;

  if (status) {
    const checklistStatus = status === 'Pending' ? 'Not Started' : status;
    conds.push(`c.status = $${idx++}`);
    vals.push(checklistStatus);
  }

  if (search) {
    conds.push(`(c.checklist_code ILIKE $${idx} OR c.title ILIKE $${idx})`);
    idx++;
    vals.push(`%${search}%`);
  }

  const { rows } = await db.query(
    `SELECT
       COUNT(ca.checklist_id)::int                                                                    AS tasks_assigned,
       COUNT(ca.checklist_id) FILTER (WHERE c.status IN ('Not Started', 'In Progress'))::int         AS pending,
       COUNT(ca.checklist_id) FILTER (WHERE c.status = 'Completed')::int                             AS completed
     FROM tbl_checklist_assignees ca
     JOIN tbl_checklists c ON c.id = ca.checklist_id
     WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0] || null;
};

// ── ASSIGNED TO EMPLOYEES SUMMARY (admin card — tasks I created) ──────────────
exports.getAssignedEmployeesSummary = async ({ zodu_id, branch_id, created_by, search, status }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'c.created_by = $3'];
  const vals  = [zodu_id, branch_id, created_by];
  let   idx   = 4;

  if (status) {
    const checklistStatus = status === 'Pending' ? 'Not Started' : status;
    conds.push(`c.status = $${idx++}`);
    vals.push(checklistStatus);
  }

  if (search) { 
    conds.push(`(
      c.checklist_code ILIKE $${idx}
      OR c.title ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM tbl_checklist_assignees x
        WHERE x.checklist_id = c.id AND x.employee_name ILIKE $${idx}
      )
    )`);
    idx++;
    vals.push(`%${search}%`);
  }

  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int                                                                  AS total_assigned,
       COUNT(*) FILTER (WHERE c.status IN ('Not Started', 'In Progress'))::int       AS pending,
       COUNT(*) FILTER (WHERE c.status = 'Completed')::int                           AS completed
     FROM tbl_checklists c
     WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0];
};

// ── MY TASK DETAIL (single checklist, for the logged-in employee) ──────────────
// checklist + this employee's assignment row + latest instance, joined in one
// query; items + this employee's progress on that instance in a second query
// (item_progress can only be joined once the instance_id is known).
exports.findMyTaskDetail = async (checklist_id, { zodu_id, branch_id, employee_id }) => {
  const { rows } = await db.query(
    `SELECT
       c.*,
       TO_CHAR(c.due_date,         'YYYY-MM-DD') AS due_date,
       TO_CHAR(c.start_date,       'YYYY-MM-DD') AS start_date,
       TO_CHAR(c.recur_end_date,   'YYYY-MM-DD') AS recur_end_date,
       TO_CHAR(c.recur_start_date, 'YYYY-MM-DD') AS recur_start_date,
       ca.id            AS assignment_id,
       ca.employee_id   AS assignment_employee_id,
       ca.employee_name AS assignment_employee_name,
       ca.status        AS assignment_status,
       ca.assigned_at   AS assignment_assigned_at,
       inst.id             AS instance_id,
       inst.scheduled_date AS instance_scheduled_date,
       inst.status         AS instance_status
     FROM tbl_checklists c
     LEFT JOIN tbl_checklist_assignees ca
       ON ca.checklist_id = c.id AND ca.employee_id = $4
     LEFT JOIN LATERAL (
       SELECT id, scheduled_date, status
       FROM tbl_checklist_instances
       WHERE checklist_id = c.id
       ORDER BY scheduled_date DESC
       LIMIT 1
     ) inst ON TRUE
     WHERE c.id = $1 AND c.zodu_id = $2 AND c.branch_id = $3`,
    [checklist_id, zodu_id, branch_id, employee_id]
  );

  const row = rows[0];
  if (!row) return null;
  if (!row.assignment_id) return { notAssigned: true };

  const { rows: items } = await db.query(
    `SELECT
       i.*,
       COALESCE(p.is_completed, false) AS is_completed,
       p.completed_at
     FROM tbl_checklist_items i
     LEFT JOIN tbl_checklist_item_progress p
       ON p.item_id = i.id AND p.instance_id = $2 AND p.employee_id = $3
     WHERE i.checklist_id = $1
     ORDER BY i.item_order`,
    [checklist_id, row.instance_id, employee_id]
  );

  return {
    ...row,
    assignment: {
      id: row.assignment_id,
      checklist_id,
      employee_id: row.assignment_employee_id,
      employee_name: row.assignment_employee_name,
      status: row.assignment_status,
      assigned_at: row.assignment_assigned_at,
    },
    instance: row.instance_id
      ? { id: row.instance_id, scheduled_date: row.instance_scheduled_date, status: row.instance_status }
      : null,
    items,
  };
};

// ── MY ASSIGNED TASKS (bottom table — tasks assigned TO logged-in employee) ─────
// Progress is scoped to each checklist's LATEST instance only (LATERAL join) —
// avoids double-counting item_progress across multiple recurring instances.
exports.findMyAssignedTasks = async ({ zodu_id, branch_id, employee_id, status, search, limit, offset }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'ca.employee_id = $3'];
  const vals  = [zodu_id, branch_id, employee_id];
  let   idx   = 4;

  if (status === 'Pending') {
    conds.push(`c.status IN ('Not Started')`);
  } else if (status) {
    conds.push(`c.status = $${idx++}`);
    vals.push(status);
  }

  if (search) {
    conds.push(`(c.checklist_code ILIKE $${idx} OR c.title ILIKE $${idx})`);
    idx++;
    vals.push(`%${search}%`);
  }

  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT
       c.id, c.checklist_code, c.title, c.description,
       c.status,
       TO_CHAR(c.due_date,   'YYYY-MM-DD') AS due_date,
       TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
       c.is_recurring,
       c.created_by_name,
       c.updated_at AS last_update,
       COALESCE(items.total_items, 0)     AS total_items,
       c.checklist_code,
       COALESCE(items.completed_items, 0) AS completed_items
     FROM tbl_checklist_assignees ca
     JOIN tbl_checklists c ON c.id = ca.checklist_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int                                          AS total_items,
         COUNT(*) FILTER (WHERE status = 'Completed')::int     AS completed_items
       FROM tbl_checklist_items
       WHERE checklist_id = c.id
     ) items ON TRUE
     WHERE ${conds.join(' AND ')}
     ORDER BY c.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};

exports.countMyAssignedTasks = async ({ zodu_id, branch_id, employee_id, status, search }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'ca.employee_id = $3'];
  const vals  = [zodu_id, branch_id, employee_id];
  let   idx   = 4;

  if (status === 'Pending') {
    conds.push(`c.status IN ('Not Started', 'In Progress')`);
  } else if (status) {
    conds.push(`c.status = $${idx++}`);
    vals.push(status);
  }

  if (search) {
    conds.push(`(c.checklist_code ILIKE $${idx} OR c.title ILIKE $${idx})`);
    idx++;
    vals.push(`%${search}%`);
  }

  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT c.id)::int AS total
     FROM tbl_checklist_assignees ca
     JOIN tbl_checklists c ON c.id = ca.checklist_id
     WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0].total;
};

// ── ASSIGNED TO EMPLOYEES (admin view — one row per CHECKLIST I assigned) ─────
// Every checklist created by this admin (created_by), with its assignees and
// item/status counts. search matches against assignee employee_name.
exports.findAssignedEmployees = async ({ zodu_id, branch_id, created_by, search, status, limit, offset }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'c.created_by = $3'];
  const vals  = [zodu_id, branch_id, created_by];
  let   idx   = 4;

  if (status) {
    const itemStatus = status === 'Pending' ? 'Not Started' : status;
    conds.push(`EXISTS (
      SELECT 1 FROM tbl_checklist_items i
      WHERE i.checklist_id = c.id AND i.status = $${idx++}
    )`);
    vals.push(itemStatus);
  }

  if (search) {
    conds.push(`(
      c.checklist_code ILIKE $${idx}
      OR c.title ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM tbl_checklist_assignees x
        WHERE x.checklist_id = c.id AND x.employee_name ILIKE $${idx}
      )
    )`);
    idx++;
    vals.push(`%${search}%`);
  }

  vals.push(limit, offset);

  const { rows } = await db.query(
    `SELECT
       c.id                                  AS checklist_id,
       c.checklist_code,
       c.title,
       c.status,
       c.created_by_name,
       TO_CHAR(c.due_date, 'YYYY-MM-DD')     AS due_date,
       c.updated_at                          AS last_activity,
       COALESCE(items.total_items, 0)        AS total_items,
       COALESCE(a.assignees, '[]'::json)     AS assignees,
       COALESCE(items.pending, 0)            AS pending,
       COALESCE(items.in_progress, 0)        AS in_progress,
       COALESCE(items.completed, 0)          AS completed,
       COALESCE(items.not_completed, 0)      AS not_completed,
       COALESCE(items.cancelled, 0)          AS cancelled
     FROM tbl_checklists c
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int                                              AS total_items,
         COUNT(*) FILTER (WHERE status = 'Not Started')::int       AS pending,
         COUNT(*) FILTER (WHERE status = 'In Progress')::int       AS in_progress,
         COUNT(*) FILTER (WHERE status = 'Completed')::int         AS completed,
         COUNT(*) FILTER (WHERE status = 'Not Completed')::int     AS not_completed,
         COUNT(*) FILTER (WHERE status = 'Cancelled')::int         AS cancelled
       FROM tbl_checklist_items
       WHERE checklist_id = c.id
     ) items ON TRUE
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'employee_id', ca.employee_id,
         'employee_name', ca.employee_name
       )) AS assignees
       FROM tbl_checklist_assignees ca
       WHERE ca.checklist_id = c.id
     ) a ON TRUE
     WHERE ${conds.join(' AND ')}
     ORDER BY c.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    vals
  );
  return rows;
};

exports.countAssignedEmployees = async ({ zodu_id, branch_id, created_by, search, status }) => {
  const conds = ['c.zodu_id = $1', 'c.branch_id = $2', 'c.created_by = $3'];
  const vals  = [zodu_id, branch_id, created_by];
  let   idx   = 4;

  if (status) {
    const itemStatus = status === 'Pending' ? 'Not Started' : status;
    conds.push(`EXISTS (
      SELECT 1 FROM tbl_checklist_items i
      WHERE i.checklist_id = c.id AND i.status = $${idx++}
    )`);
    vals.push(itemStatus);
  }

  if (search) {
    conds.push(`(
      c.checklist_code ILIKE $${idx}
      OR c.title ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM tbl_checklist_assignees x
        WHERE x.checklist_id = c.id AND x.employee_name ILIKE $${idx}
      )
    )`);
    idx++;
    vals.push(`%${search}%`);
  }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM tbl_checklists c
     WHERE ${conds.join(' AND ')}`,
    vals
  );
  return rows[0].total;
};

// ── STATS (for dashboard summary) ────────────────────────────────────────────

exports.getStats = async ({ zodu_id, branch_id }) => {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)                                                            AS total,
       COUNT(*) FILTER (WHERE status = 'Not Started')::int                AS not_started,
       COUNT(*) FILTER (WHERE status = 'In Progress')::int                AS in_progress,
       COUNT(*) FILTER (WHERE status = 'Completed')::int                  AS completed,
       COUNT(*) FILTER (WHERE status = 'Overdue')::int                    AS overdue
     FROM tbl_checklists
     WHERE zodu_id = $1 AND branch_id = $2`,
    [zodu_id, branch_id]
  );
  return rows[0];
};
