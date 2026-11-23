// Checklist definitions: create / edit / status / duplicate / delete / images /
// schedule preview. Design: §5.3 (edit policy), §8.3 (create flow).
const crypto = require('node:crypto');
const pool = require('../database/pool');
const { withTransaction } = require('../database/tx');
const repo = require('../repository/checklists');
const directory = require('../jobs/directory-sync');
const files = require('../clients/file-client');
const config = require('../config');
const schema = require('../schema');
const companySettings = require('./settings');
const { badRequest, conflict, notFound, unprocessable } = require('../utils/errors');
const { encodeCursor, decodeCursor } = require('../utils/pagination');
const { isValidTimezone, todayIn, addDays } = require('../utils/time');

const FILE_MODULE = 'checklist-v2';
const MAX_IMAGES = 6;

const horizon = () => `${Math.max(1, Number(config.GENERATION_HORIZON_HOURS) || 36)} hours`;

// The acting user's display name: their employee record in this branch.
async function actorName(tenant, userId, db = pool) {
  const { rows: [r] } = await db.query(
    'SELECT employee_name FROM ckl.employee_directory WHERE user_id = $1 AND zodu_id = $2 AND branch_id = $3 LIMIT 1',
    [userId, tenant.zodu_id, tenant.branch_id],
  );
  return r?.employee_name || 'User';
}

// Validates everything a create or edit needs from the database.
// → { schedule, rules, timezone }
async function prepare(tenant, body, { existingStartDate } = {}) {
  const schedule = schema.normalizeSchedule(body.schedule);
  const timezone = body.timezone || config.DEFAULT_TIMEZONE;
  if (!(await isValidTimezone(timezone))) throw badRequest(`Unknown time zone "${timezone}"`, 'INVALID_TIMEZONE');
  if (schedule.start_date !== existingStartDate) {
    const today = await todayIn(timezone);
    if (schedule.start_date < addDays(today, -31)) {
      throw badRequest('"schedule.start_date" may be at most 31 days in the past', 'VALIDATION_FAILED');
    }
  }
  if (body.reviewer_employee_id === undefined) body.reviewer_employee_id = null;
  // Photo / notes / partial and the notification rules come from the company's
  // settings, never from the request (Settings → Checklist settings).
  const company = await companySettings.get(tenant.zodu_id);
  body.settings = { require_photo: company.require_photo, allow_partial: company.allow_partial, allow_notes: company.allow_notes };
  const rules = companySettings.rulesForChecklist(company.rules, { hasReviewer: Boolean(body.reviewer_employee_id), schedule });
  if (body.assign_mode === 'ALL') body.assignee_employee_ids = [];

  await directory.ensureSynced(tenant);
  const wanted = [...new Set([
    ...body.assignee_employee_ids,
    ...(body.reviewer_employee_id ? [body.reviewer_employee_id] : []),
    ...rules.flatMap((r) => r.target_employee_ids),
  ])];
  let missing = await repo.missingEmployees(tenant, wanted);
  if (missing.length) {
    await directory.refresh(tenant);     // employees added since the last sync
    missing = await repo.missingEmployees(tenant, wanted);
  }
  if (missing.length) {
    throw unprocessable('Some employees are not active in this branch', 'EMPLOYEE_NOT_FOUND', { employee_ids: missing });
  }
  if (body.category_id && !(await repo.categoryUsable(tenant, body.category_id))) {
    throw unprocessable('Unknown category', 'CATEGORY_NOT_FOUND');
  }
  return { schedule, rules, timezone };
}

async function generate(checklistId) {
  const { rows: [r] } = await pool.query(
    'SELECT ckl.fn_generate_for_schedule($1, now() + $2::interval) AS n',
    [checklistId, horizon()],
  );
  return r.n;
}

// "You have been assigned a new checklist", once per checklist per person
// (dedupe key), so an edit only tells the people newly added.
async function notifyAssigned(tenant, checklistId, actorUserId) {
  await withTransaction(async (db) => {
    await db.query(
      `SELECT ckl.fn_notify(
         c.zodu_id, c.branch_id,
         ARRAY(SELECT d.user_id FROM ckl.employee_directory d
                WHERE d.zodu_id = c.zodu_id AND d.branch_id = c.branch_id AND d.is_active AND d.user_id IS NOT NULL
                  AND (c.assign_mode = 'ALL' OR EXISTS (SELECT 1 FROM ckl.checklist_assignees a
                                                        WHERE a.checklist_id = c.id AND a.employee_id = d.employee_id))),
         'CHECKLIST_ASSIGNED', t.severity, t.title, t.body, 'CHECKLIST', c.id, '/checklists',
         jsonb_build_object('checklist_id', c.id, 'checklist_title', c.name),
         'CHECKLIST_ASSIGNED:' || c.id, '{IN_APP}', false)
       FROM ckl.checklists c
       CROSS JOIN LATERAL ckl.fn_render_notification('CHECKLIST_ASSIGNED', c.name, NULL, NULL, 0, 0, 0, NULL) t
      WHERE c.id = $1 AND c.zodu_id = $2 AND c.branch_id = $3 AND c.status = 'ACTIVE' AND c.deleted_at IS NULL`,
      [checklistId, tenant.zodu_id, tenant.branch_id],
    );
  }, { actorUserId });
}

// Next `count` days with their times, computed by the same SQL as generation.
async function previewOccurrences(schedule, from, count = 5, db = pool) {
  const { rows } = await db.query(
    `SELECT p.occurs_on AS date,
            ARRAY(SELECT to_char(t, 'HH24:MI') FROM unnest(p.times) AS t ORDER BY t) AS times
       FROM ckl.fn_preview_occurrences($1::jsonb, $2::date, $3) p`,
    [JSON.stringify(schedule), from, count],
  );
  return rows;
}

async function getDefinition(tenant, id) {
  const def = await repo.findDefinition(tenant, id);
  if (!def) throw notFound('Checklist not found');
  const out = repo.definitionOut(def, tenant);
  const today = await todayIn(def.c.timezone);
  out.next_occurrences = def.c.status === 'ACTIVE' ? await previewOccurrences(out.schedule, today, 5) : [];
  return out;
}

async function create(tenant, actor, body) {
  const { schedule, rules, timezone } = await prepare(tenant, body);
  const name = await actorName(tenant, actor.userId);
  const id = await withTransaction(async (db) => {
    const { rows: [{ code }] } = await db.query('SELECT ckl.fn_next_checklist_code($1, $2) AS code', [tenant.zodu_id, tenant.branch_id]);
    const { rows: [c] } = await db.query(
      `INSERT INTO ckl.checklists
         (zodu_id, branch_id, code, name, description, category_id, priority, assign_mode, reviewer_employee_id,
          timezone, require_photo, allow_partial, allow_notes, created_by_user_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [tenant.zodu_id, tenant.branch_id, code, body.name, body.description || null, body.category_id || null,
        body.priority, body.assign_mode, body.reviewer_employee_id, timezone, body.settings.require_photo,
        body.settings.allow_partial, body.settings.allow_notes, actor.userId, name],
    );
    await repo.insertSchedule(db, c.id, schedule);
    await repo.replaceTasks(db, c.id, await withTaskFiles(db, tenant, body.tasks));
    await repo.replaceAssignees(db, c.id, body.assignee_employee_ids);
    await repo.syncRules(db, c.id, rules);
    return c.id;
  }, { actorUserId: actor.userId });

  await generate(id);
  await notifyAssigned(tenant, id, actor.userId);
  return getDefinition(tenant, id);
}

// The tasks with their reference files as stored snapshots; a file that isn't one
// of this branch's uploads refuses the save.
async function withTaskFiles(db, tenant, tasks) {
  const out = [];
  for (const t of tasks) {
    const ids = [...new Set((t.attachments || []).map((a) => a.id))];
    const snaps = await repo.taskFileSnapshots(db, tenant, ids);
    if (!snaps) throw unprocessable('A task file was not found. Upload it again.', 'TASK_FILE_NOT_FOUND');
    out.push({ ...t, attachments: snaps });
  }
  return out;
}

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function update(tenant, actor, id, body) {
  const current = await repo.findDefinition(tenant, id);
  if (!current) throw notFound('Checklist not found');
  const { schedule, rules, timezone } = await prepare(tenant, body, { existingStartDate: current.s.start_date });
  const name = await actorName(tenant, actor.userId);

  await withTransaction(async (db) => {
    const locked = await repo.findDefinition(tenant, id, db, { forUpdate: true });
    if (!locked) throw notFound('Checklist not found');
    if (locked.c.row_version !== body.row_version) {
      throw conflict('This checklist was changed by someone else', 'CHECKLIST_VERSION_CONFLICT', { row_version: locked.c.row_version });
    }
    const before = repo.scheduleOut(locked.s);
    const recurrenceChanged = timezone !== locked.c.timezone
      || schema.RECURRENCE_FIELDS.some((f) => !sameValue(f.endsWith('time') || f.startsWith('window')
        ? (schedule[f] ? schedule[f].slice(0, 5) : null) : schedule[f], before[f]));

    await db.query(
      `UPDATE ckl.checklists
          SET name = $4, description = $5, category_id = $6, priority = $7, assign_mode = $8,
              reviewer_employee_id = $9, timezone = $10, require_photo = $11, allow_partial = $12,
              allow_notes = $13, updated_by_user_id = $14, updated_by_name = $15, row_version = row_version + 1
        WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
      [id, tenant.zodu_id, tenant.branch_id, body.name, body.description || null, body.category_id || null,
        body.priority, body.assign_mode, body.reviewer_employee_id, timezone, body.settings.require_photo,
        body.settings.allow_partial, body.settings.allow_notes, actor.userId, name],
    );
    await repo.updateSchedule(db, id, schedule);
    await repo.replaceTasks(db, id, await withTaskFiles(db, tenant, body.tasks));
    await repo.replaceAssignees(db, id, body.assignee_employee_ids);
    await repo.syncRules(db, id, rules);

    // Effective point (§5.3), in the checklist's zone: NOW = the start of today, so every
    // untouched run of today is rebuilt, including ones whose time has already passed
    // (otherwise e.g. a 09:00 daily run edited at 14:00 into a one-time checklist stays
    // next to the new run and looks like a duplicate). Otherwise the start of tomorrow.
    // Started / completed runs are never touched either way.
    const { rows: [{ p_from: pFrom }] } = await db.query(
      `SELECT (((now() AT TIME ZONE $1)::date + $2::int)::timestamp AT TIME ZONE $1) AS p_from`,
      [timezone, body.apply_from === 'NOW' ? 0 : 1],
    );
    await db.query('SELECT ckl.fn_reschedule_checklist($1, $2, $3)', [id, pFrom, recurrenceChanged]);
  }, { actorUserId: actor.userId });

  await generate(id);
  await notifyAssigned(tenant, id, actor.userId);
  return getDefinition(tenant, id);
}

// Pause / archive / delete: drop untouched future runs, cancel the other open
// future ones (§5.3). In the caller's transaction.
async function stopFutureRuns(db, id) {
  await db.query('SELECT ckl.fn_reschedule_checklist($1, now(), false)', [id]);
  await db.query(
    `UPDATE ckl.runs SET status = 'CANCELLED', row_version = row_version + 1
      WHERE checklist_id = $1 AND slot_at > now() AND status IN ('TODO','IN_PROGRESS')`,
    [id],
  );
}

async function setStatus(tenant, actor, id, status) {
  const name = await actorName(tenant, actor.userId);
  const changed = await withTransaction(async (db) => {
    const { rows: [c] } = await db.query(
      `SELECT status FROM ckl.checklists
        WHERE id = $1 AND zodu_id = $2 AND branch_id = $3 AND deleted_at IS NULL FOR UPDATE`,
      [id, tenant.zodu_id, tenant.branch_id],
    );
    if (!c) throw notFound('Checklist not found');
    if (c.status === status) return false;
    await db.query(
      `UPDATE ckl.checklists SET status = $2, updated_by_user_id = $3, updated_by_name = $4, row_version = row_version + 1
        WHERE id = $1`,
      [id, status, actor.userId, name],
    );
    if (status !== 'ACTIVE') await stopFutureRuns(db, id);
    return true;
  }, { actorUserId: actor.userId });
  if (changed && status === 'ACTIVE') {
    await generate(id);
    await notifyAssigned(tenant, id, actor.userId);
  }
  return getDefinition(tenant, id);
}

async function remove(tenant, actor, id) {
  const name = await actorName(tenant, actor.userId);
  await withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE ckl.checklists SET deleted_at = now(), updated_by_user_id = $4, updated_by_name = $5,
              row_version = row_version + 1
        WHERE id = $1 AND zodu_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
      [id, tenant.zodu_id, tenant.branch_id, actor.userId, name],
    );
    if (!rowCount) throw notFound('Checklist not found');
    await stopFutureRuns(db, id);
    // A deleted checklist leaves no unfinished work behind: runs already started or
    // overdue (any day), waiting for review, or missed are cancelled, so they drop off
    // every board and the overdue list. Completed runs stay as history.
    await db.query(
      `UPDATE ckl.runs SET status = 'CANCELLED', row_version = row_version + 1
        WHERE checklist_id = $1 AND status IN ('TODO','IN_PROGRESS','PENDING_REVIEW','MISSED')`,
      [id],
    );
  }, { actorUserId: actor.userId });
}

// A copy under a new code, PAUSED, with a fresh schedule state (no images:
// those files belong to the original).
async function duplicate(tenant, actor, id) {
  const src = await repo.findDefinition(tenant, id);
  if (!src) throw notFound('Checklist not found');
  const name = await actorName(tenant, actor.userId);
  const newId = await withTransaction(async (db) => {
    const { rows: [{ code }] } = await db.query('SELECT ckl.fn_next_checklist_code($1, $2) AS code', [tenant.zodu_id, tenant.branch_id]);
    const c = src.c;
    const { rows: [n] } = await db.query(
      `INSERT INTO ckl.checklists
         (zodu_id, branch_id, code, name, description, category_id, priority, status, assign_mode,
          reviewer_employee_id, timezone, require_photo, allow_partial, allow_notes, created_by_user_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PAUSED',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [tenant.zodu_id, tenant.branch_id, code, `${c.name} (copy)`.slice(0, 150), c.description, c.category_id,
        c.priority, c.assign_mode, c.reviewer_employee_id, c.timezone, c.require_photo, c.allow_partial,
        c.allow_notes, actor.userId, name],
    );
    const s = repo.scheduleOut(src.s);
    const t = (v) => (v ? `${v}:00` : null);
    await repo.insertSchedule(db, n.id, { ...s, trigger_time: t(s.trigger_time), window_start: t(s.window_start), window_end: t(s.window_end) });
    await repo.replaceTasks(db, n.id, src.tasks);
    await repo.replaceAssignees(db, n.id, src.assignees.map((a) => a.employee_id));
    await repo.syncRules(db, n.id, src.rules);
    return n.id;
  }, { actorUserId: actor.userId });
  return getDefinition(tenant, newId);
}

async function list(tenant, filters) {
  const key = decodeCursor(filters.cursor);
  const rows = await repo.list(tenant, filters, key);
  const page = rows.slice(0, filters.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(repo.listRowOut),
    pagination: {
      limit: filters.limit,
      next_cursor: rows.length > filters.limit ? encodeCursor([last.created_key, last.id]) : null,
    },
  };
}

// ── task files (file-service, module checklist-v2, category task-files) ─────
// Uploaded before the checklist is saved; the save lists them on its tasks.
async function addTaskFiles(tenant, actor, uploaded, ctx) {
  if (!uploaded.length) throw badRequest('No files', 'NO_FILES');
  const stored = await files.upload(ctx, { module: FILE_MODULE, entityId: crypto.randomUUID(), category: 'task-files', files: uploaded });
  try {
    const out = [];
    for (let i = 0; i < stored.length; i++) {
      const { rows: [r] } = await pool.query(
        `INSERT INTO ckl.task_files (zodu_id, branch_id, file_id, file_name, content_type, size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, file_id, file_name, content_type`,
        [tenant.zodu_id, tenant.branch_id, stored[i].file_id,
          String(stored[i].original_name || uploaded[i].originalname || 'file').slice(0, 255),
          String(stored[i].mime_type || stored[i].content_type || uploaded[i].mimetype).slice(0, 120),
          uploaded[i].size ?? null, actor.userId],
      );
      out.push(r);
    }
    return repo.attachmentsOut(out, tenant);
  } catch (err) {
    files.quietly(files.remove(ctx, stored.map((f) => f.file_id)));
    throw err;
  }
}

// ── images (file-service, module checklist-v2, category images) ─────────────
async function addImages(tenant, actor, id, uploaded, ctx) {
  if (!uploaded.length) throw badRequest('No files', 'NO_FILES');
  const { rows: used } = await pool.query(
    `SELECT i.position FROM ckl.checklist_images i JOIN ckl.checklists c ON c.id = i.checklist_id
      WHERE c.id = $1 AND c.zodu_id = $2 AND c.branch_id = $3 AND c.deleted_at IS NULL`,
    [id, tenant.zodu_id, tenant.branch_id],
  );
  if (!(await repo.findDefinition(tenant, id))) throw notFound('Checklist not found');
  const free = [1, 2, 3, 4, 5, 6].filter((p) => !used.some((u) => u.position === p));
  if (uploaded.length > free.length) {
    throw unprocessable(`A checklist has at most ${MAX_IMAGES} attachments (${free.length} left)`, 'TOO_MANY_IMAGES');
  }
  const stored = await files.upload(ctx, { module: FILE_MODULE, entityId: id, category: 'images', files: uploaded });
  try {
    await withTransaction(async (db) => {
      for (let i = 0; i < stored.length; i++) {
        await db.query(
          `INSERT INTO ckl.checklist_images (checklist_id, file_id, file_name, position, uploaded_by_user_id, content_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, stored[i].file_id, String(stored[i].original_name || uploaded[i].originalname || 'file').slice(0, 255), free[i], actor.userId,
            String(stored[i].mime_type || uploaded[i].mimetype).slice(0, 120)],
        );
      }
    }, { actorUserId: actor.userId });
  } catch (err) {
    files.quietly(files.remove(ctx, stored.map((f) => f.file_id)));
    throw err;
  }
  return getDefinition(tenant, id);
}

async function removeImage(tenant, id, imageId, ctx) {
  const { rows: [img] } = await pool.query(
    `DELETE FROM ckl.checklist_images i USING ckl.checklists c
      WHERE i.id = $1 AND i.checklist_id = c.id AND c.id = $2 AND c.zodu_id = $3 AND c.branch_id = $4
      RETURNING i.file_id`,
    [imageId, id, tenant.zodu_id, tenant.branch_id],
  );
  if (!img) throw notFound('Image not found');
  files.quietly(files.remove(ctx, [img.file_id]));
}

async function schedulePreview(tenant, body) {
  const schedule = schema.normalizeSchedule(body.schedule);
  const from = body.from || await todayIn(config.DEFAULT_TIMEZONE);
  return previewOccurrences(schedule, from, body.count);
}

module.exports = {
  create, update, setStatus, remove, duplicate, list, getDefinition, addImages, removeImage, addTaskFiles, schedulePreview,
  generate, previewOccurrences, actorName, FILE_MODULE,
};
