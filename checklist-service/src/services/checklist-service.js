const db     = require('../database/connection');
const repo   = require('../repository/checklist-repo');
const minio  = require('../utils/minio');
const { parsePage, buildMeta } = require('../utils/pagination');

// Derive checklist status from its items.
// Rules:
//   - Cancelled items are ignored (treated as if they don't exist)
//   - If all remaining items are Completed → Completed
//   - If any remaining item is not Not Started → In Progress
//   - Otherwise → Not Started
const deriveChecklistStatus = (items) => {
  const active = items.filter(i => i.status !== 'Cancelled');
  if (active.length === 0) return 'Completed';
  if (active.every(i => i.status === 'Completed')) return 'Completed';
  if (active.some(i => i.status !== 'Not Started')) return 'In Progress';
  return 'Not Started';
};

// ── CREATE ────────────────────────────────────────────────────────────────────

exports.createChecklist = async (data) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    console.log('Creating checklist with data:', data);

    // 1. Insert master checklist
    const checklist = await repo.insertChecklist(client, data);

    // 2. Insert assignees + items concurrently inside the same transaction
    const [assignees, items] = await Promise.all([
      repo.insertAssignees(client, checklist.id, data.assignees),
      repo.insertItems(client, checklist.id, data.items),
    ]);

    // 3. Always create the first instance
    //    Non-recurring: use due_date (or today)
    //    Recurring: use recur_start_date (or today) as the first occurrence
    const scheduled_date = data.is_recurring
      ? (data.recur_start_date || new Date().toISOString().slice(0, 10))
      : (data.due_date         || new Date().toISOString().slice(0, 10));

    await client.query(
      `INSERT INTO tbl_checklist_instances
         (checklist_id, zodu_id, branch_id, scheduled_date, status)
       VALUES ($1,$2,$3,$4,'Not Started')
       ON CONFLICT DO NOTHING`,
      [checklist.id, data.zodu_id, data.branch_id, scheduled_date]
    );

    await client.query('COMMIT');

    return {
      success: true,
      data: { ...checklist, assignees, items },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── LIST ──────────────────────────────────────────────────────────────────────

exports.getChecklists = async ({ zodu_id, branch_id, status, search, page = 1, limit = 10 }) => {
  const { limit: lim, offset } = parsePage(page, limit);

  // Run data + count + stats concurrently
  const [rows, total, stats] = await Promise.all([
    repo.findAll({ zodu_id, branch_id, status, search, limit: lim, offset }),
    repo.countAll({ zodu_id, branch_id, status, search }),
    repo.getStats({ zodu_id, branch_id }),
  ]);

  return {
    success: true,
    stats,
    data: rows,
    pagination: buildMeta(total, page, lim),
  };
};

// ── MY TASK SUMMARY (top card — logged-in employee's own summary) ─────────────
// Returns single row: how many tasks assigned to ME, broken by status

exports.getMyTaskSummary = async ({ zodu_id, branch_id, employee_id, search, status }) => {
  const summary = await repo.getMyTaskSummary({ zodu_id, branch_id, employee_id, search, status });
  return { success: true, data: summary };
};

// ── MY ASSIGNED TASKS (bottom table — tasks assigned TO logged-in employee) ────
// Returns tasks where employee_id is in tbl_checklist_assignees
// with progress (completed_items / total_items) per task

exports.getMyAssignedTasks = async ({ zodu_id, branch_id, employee_id, status, search, page = 1, limit = 10 }) => {
  const { limit: lim, offset } = parsePage(page, limit);

  const [rows, total] = await Promise.all([
    repo.findMyAssignedTasks({ zodu_id, branch_id, employee_id, status, search, limit: lim, offset }),
    repo.countMyAssignedTasks({ zodu_id, branch_id, employee_id, status, search }),
  ]);

  return {
    success: true,
    data:  rows,
    pagination: buildMeta(total, page, lim),
  };
};

// ── ASSIGNED TO EMPLOYEES (admin view — every employee with tasks I assigned) ──

exports.getAssignedEmployeesSummary = async ({ zodu_id, branch_id, created_by, search, status }) => {
  const summary = await repo.getAssignedEmployeesSummary({ zodu_id, branch_id, created_by, search, status });
  return { success: true, data: summary };
};

exports.getAssignedEmployees = async ({ zodu_id, branch_id, created_by, search, status, page = 1, limit = 10 }) => {
  const { limit: lim, offset } = parsePage(page, limit);

  const [rows, total] = await Promise.all([
    repo.findAssignedEmployees({ zodu_id, branch_id, created_by, search, status, limit: lim, offset }),
    repo.countAssignedEmployees({ zodu_id, branch_id, created_by, search, status }),
  ]);

  return {
    success: true,
    data: rows,
    pagination: buildMeta(total, page, lim),
  };
};

// ── MY TASK DETAIL (single checklist detail, scoped to the logged-in employee) ─

exports.getMyTaskDetail = async (checklist_id, { zodu_id, branch_id, employee_id }) => {
  const result = await repo.findMyTaskDetail(checklist_id, { zodu_id, branch_id, employee_id });
  if (!result) return null;
  if (result.notAssigned) return { success: false, error: 'Task not assigned to this employee' };

  return { success: true, data: result };
};

// ── DETAIL ────────────────────────────────────────────────────────────────────

exports.getChecklistById = async (id, { zodu_id, branch_id }) => {
  const checklist = await repo.findById(id, { zodu_id, branch_id });
  if (!checklist) return null;

  // Fetch assignees, items, attachments concurrently
  const [assignees, items, attachments] = await Promise.all([
    repo.findAssignees(id),
    repo.findItems(id),
    repo.findAttachments(id),
  ]);

  return {
    success: true,
    data: { ...checklist, assignees, items, attachments },
  };
};

// ── UPDATE TASK STATUS (admin "Update Task Status" modal — bulk item update) ───
// items: [{ item_id, status, remarks }]. Updates each item, then derives the
// checklist's own status from the resulting item statuses.
exports.updateTaskStatus = async (checklist_id, { zodu_id, branch_id, items }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const checklist = await repo.findById(checklist_id, { zodu_id, branch_id });
    if (!checklist) throw new Error('Checklist not found');

    await Promise.all(
      items.map(it => repo.updateItemStatus(it.item_id, { status: it.status, remarks: it.remarks, employee_id: it.employee_id }))
    );

    const allItems = await repo.findItems(checklist_id);
    const derivedStatus = deriveChecklistStatus(allItems);

    const updatedChecklist = await repo.updateChecklist(
      client, checklist_id, { status: derivedStatus }, { zodu_id, branch_id }
    );

    await client.query('COMMIT');

    return {
      success: true,
      data: { ...(updatedChecklist || checklist), items: allItems },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

exports.updateChecklist = async (id, data) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await repo.findById(id, { zodu_id: data.zodu_id, branch_id: data.branch_id });
    if (!existing) throw new Error('Checklist not found');

    const updated = await repo.updateChecklist(client, id, {
      ...data,
      updated_by:      data.created_by,
      updated_by_name: data.created_by_name,
    }, { zodu_id: data.zodu_id, branch_id: data.branch_id });

    // If assignees or items sent — replace entirely
    // If attachments sent — update matching file entries within the array
    const [assignees, items, attachments] = await Promise.all([
      data.assignees
        ? repo.upsertAssignees(client, id, data.assignees)
        : repo.findAssignees(id),
      data.items
        ? repo.upsertItems(client, id, data.items)
        : repo.findItems(id),
      data.attachments
        ? repo.updateAttachments(client, id, data.attachments)
        : repo.findAttachments(id),
    ]);

    await client.query('COMMIT');

    return {
      success: true,
      data: { ...(updated || existing), assignees, items, attachments },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────

exports.deleteChecklist = async (id, { zodu_id, branch_id }) => {
  const deleted = await repo.deleteChecklist(id, { zodu_id, branch_id });
  if (!deleted) throw new Error('Checklist not found');
  return { success: true };
};

// ── ATTACHMENTS ───────────────────────────────────────────────────────────────

// Uploads multiple files — appends to the checklist's single attachments row
// (file_url array). files = array of multer file objects (req.files)
exports.uploadAttachments = async (checklist_id, files, { zodu_id, branch_id, employee_id, employee_name }) => {
  const checklist = await repo.findById(checklist_id, { zodu_id, branch_id });
  if (!checklist) throw new Error('Checklist not found');

  if (!files?.length) throw new Error('At least one file is required');
  if (files.length > 5) throw new Error('Maximum 5 attachments allowed per checklist');

  // Upload all files to MinIO concurrently
  const uploadedFiles = await Promise.all(
    files.map(file => minio.uploadFile(file, `checklist-attachments/${checklist_id}`))
  );

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const attachmentRow = await repo.insertAttachments(client, {
      checklist_id,
      files:            uploadedFiles,
      uploaded_by:      employee_id,
      uploaded_by_name: employee_name,
    });
    await client.query('COMMIT');
    return { success: true, data: attachmentRow.file_url };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Upload one or more files into a checklist item's JSONB array
// Used by admin on create OR employee when completing the item
// files = array of multer file objects
exports.uploadItemFile = async (item_id, files, employee_id, employee_name, isEmployeeUpload = false) => {
  const { v4: uuidv4 } = require('uuid');

  const uploadedFiles = await Promise.all(
    files.map(file => minio.uploadFile(file, `checklist-item-files/${item_id}`))
  );

  const fileObjs = uploadedFiles.map(uploaded => ({
    id:               uuidv4(),
    file_name:        uploaded.fileName,
    file_url:         uploaded.fileUrl,
    uploaded_by:      employee_id,
    uploaded_by_name: employee_name,
  }));

  const result = isEmployeeUpload
    ? await repo.appendEmployeeFileToItem(item_id, fileObjs)
    : await repo.appendFileToItem(item_id, fileObjs);

  if (!result) throw new Error('Checklist item not found');

  return { success: true, data: result };
};

// Remove one file from the checklist attachments JSONB array by file id
exports.deleteAttachment = async (checklist_id, file_id) => {
  const result = await repo.deleteAttachment(file_id, checklist_id);
  if (!result) throw new Error('Attachment not found');
  return { success: true, data: result.file_url || [] };
};

// Delete a single checklist item by id, then re-derive and sync checklist status
exports.deleteItem = async (item_id) => {
  const checklist_id = await repo.deleteItem(item_id);
  if (!checklist_id) throw new Error('Checklist item not found');

  const remainingItems = await repo.findItems(checklist_id);
  const derivedStatus  = deriveChecklistStatus(remainingItems);
  await repo.updateChecklistStatus(checklist_id, derivedStatus);

  return { success: true };
};

// Remove one file from a checklist item JSONB array by file id
exports.deleteItemFile = async (item_id, file_id, isEmployeeUpload = false) => {
  const result = isEmployeeUpload
    ? await repo.removeEmployeeFileFromItem(item_id, file_id)
    : await repo.removeFileFromItem(item_id, file_id);
  if (!result) throw new Error('Checklist item not found');
  return { success: true, data: result };
};

// ── INSTANCES ─────────────────────────────────────────────────────────────────

exports.getInstances = async ({ checklist_id, zodu_id, branch_id, status, page = 1, limit = 10 }) => {
  const { limit: lim, offset } = parsePage(page, limit);

  const [rows, total] = await Promise.all([
    repo.findInstances({ checklist_id, zodu_id, branch_id, status, limit: lim, offset }),
    repo.countInstances({ checklist_id, zodu_id, branch_id, status }),
  ]);

  return {
    success: true,
    data: rows,
    pagination: buildMeta(total, page, lim),
  };
};

// ── ITEM PROGRESS ─────────────────────────────────────────────────────────────

exports.markItemProgress = async (d) => {
  const progress = await repo.upsertItemProgress(d);

  // Re-compute instance status based on all employee completions
  const allProgress = await repo.getInstanceProgress(d.instance_id, d.employee_id);
  const total       = allProgress.length;
  const completed   = allProgress.filter(p => p.is_completed).length;

  let instanceStatus = 'Not Started';
  if (completed > 0 && completed < total) instanceStatus = 'In Progress';
  if (completed === total && total > 0)   instanceStatus = 'Completed';

  await db.query(
    `UPDATE tbl_checklist_instances SET status = $1 WHERE id = $2`,
    [instanceStatus, d.instance_id]
  );

  return {
    success: true,
    data: {
      progress,
      summary: { total, completed, instance_status: instanceStatus },
    },
  };
};

exports.getItemProgress = async (instance_id, employee_id) => {
  const rows = await repo.getInstanceProgress(instance_id, employee_id);
  return { success: true, data: rows };
};
