// Runs: the board, the detail drawer and every run action. Transition rules:
// §8.5 and the state machine in §9. Each action locks the run row; run-level
// actions also check row_version (409 on mismatch). Status changes fire the
// event rules through ckl.trg_runs_after_update, whatever path made them.
const { withTransaction } = require('../database/tx');
const repo = require('../repository/runs');
const files = require('../clients/file-client');
const { FILE_MODULE } = require('./checklists');
const { badRequest, conflict, forbidden, notFound, unprocessable } = require('../utils/errors');
const { encodeCursor, decodeCursor } = require('../utils/pagination');
const { daysBetween } = require('../utils/time');

const MAX_PHOTOS_PER_ITEM = 5;
const OPEN = ['TODO', 'IN_PROGRESS'];

// ── reading ────────────────────────────────────────────────────────────────
// view=team needs checklist:read; otherwise the board is forced to the caller's own runs.
function scopeFilters(f, { canRead, me }) {
  if (f.from && daysBetween(f.from, f.to) > 31) throw badRequest('"from".."to" may span at most 31 days');
  if (f.from && f.to < f.from) throw badRequest('"to" must not be before "from"');
  if (!f.date && !f.from) throw badRequest('"date" or "from" + "to" is required');
  const team = f.view === 'team' && canRead;
  return { ...f, assignee: team ? f.employee_id : me };
}

async function list(tenant, f, ctx) {
  const scoped = scopeFilters(f, ctx);
  if (!scoped.assignee && scoped.view !== 'team') return { data: [], pagination: { limit: f.limit, next_cursor: null } };
  if (!scoped.assignee && !ctx.canRead) return { data: [], pagination: { limit: f.limit, next_cursor: null } };
  const rows = await repo.list(tenant, scoped, decodeCursor(f.cursor));
  const page = rows.slice(0, f.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(repo.runOut),
    pagination: { limit: f.limit, next_cursor: rows.length > f.limit ? encodeCursor([last.due_key, last.id]) : null },
  };
}

async function summary(tenant, f, ctx) {
  const scoped = scopeFilters(f, ctx);
  if (!scoped.assignee && !(scoped.view === 'team' && ctx.canRead)) {
    return { total: 0, todo: 0, in_progress: 0, overdue: 0, completed: 0, pending_review: 0, missed: 0, completed_late: 0, completion_rate: 0 };
  }
  return repo.summary(tenant, scoped);
}

async function reviewQueue(tenant, me) {
  if (!me) return [];
  return (await repo.reviewQueue(tenant, me)).map(repo.runOut);
}

// A shared run (assignee NULL, "Assign To All") belongs to every employee of the branch.
const isAssignee = (run, me) => Boolean(me) && (run.assignee_employee_id === null || me === run.assignee_employee_id);

// Run + items + photos + events: the assignee (anyone, on a shared run), the reviewer, or checklist:read.
async function detail(tenant, id, ctx) {
  const r = await repo.findRun(tenant, id);
  if (!r) throw notFound('Run not found');
  const mine = isAssignee(r, ctx.me) || (ctx.me && ctx.me === r.reviewer_employee_id);
  if (!mine && !ctx.canRead) throw forbidden();
  const [items, events] = await Promise.all([repo.items(id), repo.events(id)]);
  return {
    ...repo.runOut(r),
    items: items.map((i) => repo.itemOut(i, tenant)),
    events: events.map((e) => ({
      id: Number(e.id), event_type: e.event_type, from_status: e.from_status, to_status: e.to_status,
      actor: e.actor_user_id ? { user_id: e.actor_user_id, name: e.actor_name } : null,
      payload: e.payload, created_at: e.created_at,
    })),
  };
}

// ── shared checks ──────────────────────────────────────────────────────────
async function locked(db, tenant, id) {
  const run = await repo.lockRun(db, tenant, id);
  if (!run) throw notFound('Run not found');
  return run;
}

// Ticking items, photos, notes, complete-all and submit: the assigned employee (anyone in
// the branch on a shared run) or the checklist's creator. Other managers review, reassign
// and edit instead; checklist:edit does not let them complete someone else's work.
function mayAct(run, ctx) {
  if (isAssignee(run, ctx.me)) return;
  if (ctx.userId && ctx.userId === run.creator_user_id) return;
  throw forbidden('Only the assigned employee or the checklist creator can complete this checklist', 'NOT_ASSIGNEE');
}

function checkVersion(run, rowVersion) {
  if (run.row_version !== rowVersion) {
    throw conflict('This checklist was updated by someone else', 'RUN_VERSION_CONFLICT', { row_version: run.row_version });
  }
}

// Items can change on TODO / IN_PROGRESS runs and on COMPLETED runs nobody reviewed yet.
// A run for a later day can be worked on (and completed) ahead of time.
function checkItemsEditable(run) {
  const approved = run.status === 'COMPLETED' && run.reviewed_at;
  if (['MISSED', 'CANCELLED', 'PENDING_REVIEW'].includes(run.status) || approved) {
    throw conflict(`This checklist is ${run.status === 'PENDING_REVIEW' ? 'waiting for review' : 'closed'}`, 'RUN_CLOSED');
  }
}

function checkOpen(run) {
  if (!OPEN.includes(run.status)) throw conflict('This checklist is no longer open', 'RUN_CLOSED');
}

async function event(db, run, type, actorUserId, payload = {}) {
  await db.query(
    `INSERT INTO ckl.run_events (run_id, zodu_id, branch_id, event_type, actor_user_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [run.id, run.zodu_id, run.branch_id, type, actorUserId, payload],
  );
}

// Who hands the run in: kept while it stays handed in, cleared when it reopens.
const SUBMITTED_BY = (statusParam, meParam) => `
            submitted_by_employee_id = CASE WHEN ${statusParam} IN ('PENDING_REVIEW','COMPLETED')
                                            THEN CASE WHEN status = ${statusParam} THEN submitted_by_employee_id ELSE ${meParam} END END,
            submitted_by_name        = CASE WHEN ${statusParam} IN ('PENDING_REVIEW','COMPLETED')
                                            THEN CASE WHEN status = ${statusParam} THEN submitted_by_name
                                                      ELSE (SELECT d.employee_name FROM ckl.employee_directory d
                                                             WHERE d.zodu_id = runs.zodu_id AND d.branch_id = runs.branch_id
                                                               AND d.employee_id = ${meParam}) END END,`;

// Recount and move the run to the status its items imply (§8.5 step 4).
// A task is closed when it is done or marked can't do; the run completes only when every task is closed.
async function settleStatus(db, run, me) {
  const { rows: [{ done, skipped, total }] } = await db.query(
    `SELECT count(*) FILTER (WHERE is_done OR is_skipped) AS done, count(*) FILTER (WHERE is_skipped) AS skipped,
            count(*) AS total FROM ckl.run_items WHERE run_id = $1`,
    [run.id],
  );
  let status;
  if (total > 0 && done === total) status = run.requires_review ? 'PENDING_REVIEW' : 'COMPLETED';
  else if (done > 0) status = 'IN_PROGRESS';
  else status = 'TODO';
  await db.query(
    `UPDATE ckl.runs
        SET done_items   = $2::int,
            skipped_items = $5::int,
            status       = $3::text,
            started_at   = CASE WHEN $2::int > 0 THEN COALESCE(started_at, now()) ELSE started_at END,
            submitted_at = CASE WHEN $3::text = 'PENDING_REVIEW' THEN now() ELSE submitted_at END,
            completed_at = CASE WHEN $3::text = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE NULL END,${SUBMITTED_BY('$3::text', '$4::uuid')}
            row_version  = row_version + 1
      WHERE id = $1`,
    [run.id, done, status, me || null, skipped],
  );
}

// ── item actions ───────────────────────────────────────────────────────────
// SET list that takes a task's sub-status off (and re-opens it if the status closed it).
const CLEAR_SUB_STATUS = `sub_status_id = NULL, sub_status_name = NULL, sub_status_color = NULL, sub_status_closes = false,
  sub_status_at = NULL, sub_status_by_employee_id = NULL,
  is_skipped = false, skip_reason = NULL, skipped_at = NULL, skipped_by_employee_id = NULL`;

// Desired state, idempotent: sending the same is_done / note / sub_status_id twice changes nothing.
// sub_status_id: one of the company's task statuses (Settings); a closing one closes the
// task (only when the run allows it), a label-only one keeps it open; null clears it.
// Ticking a task done clears its status, and setting a status un-ticks it.
async function updateItem(tenant, id, itemId, body, ctx) {
  await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    mayAct(run, ctx);
    checkItemsEditable(run);
    const { rows: [item] } = await db.query(
      `SELECT i.*, (SELECT count(*) FROM ckl.run_item_photos p WHERE p.run_item_id = i.id) AS photo_count
         FROM ckl.run_items i WHERE i.id = $1 AND i.run_id = $2`,
      [itemId, id],
    );
    if (!item) throw notFound('Item not found');

    let changed = false;
    if (body.note !== undefined) {
      const note = body.note ? body.note : null;
      if (note && !item.allow_notes) throw unprocessable('Notes are not allowed on this item', 'NOTES_NOT_ALLOWED');
      if (note !== item.note) {
        await db.query('UPDATE ckl.run_items SET note = $2 WHERE id = $1', [itemId, note]);
        await event(db, run, 'NOTE', ctx.userId, { item_id: itemId });
        changed = true;
      }
    }
    let outcome = false;
    if (body.sub_status_id !== undefined) {
      if (body.sub_status_id) {
        const { rows: [st] } = await db.query(
          'SELECT id, name, color, closes_task FROM ckl.task_statuses WHERE id = $1 AND zodu_id = $2',
          [body.sub_status_id, tenant.zodu_id],
        );
        if (!st) throw unprocessable('Unknown task status', 'SUB_STATUS_NOT_FOUND');
        if (st.closes_task && !run.allow_partial) {
          throw unprocessable(`"${st.name}" closes the task, which this checklist doesn't allow: every task must be done`, 'CLOSING_STATUS_NOT_ALLOWED');
        }
        if (item.sub_status_id !== st.id) {
          // A status replaces a tick: a task is either done or has a status.
          await db.query(
            `UPDATE ckl.run_items
                SET sub_status_id = $2::uuid, sub_status_name = $3::varchar, sub_status_color = $4::varchar, sub_status_closes = $5::boolean,
                    sub_status_at = now(), sub_status_by_employee_id = $6::uuid,
                    is_skipped = $5::boolean, skip_reason = CASE WHEN $5::boolean THEN $3::varchar END,
                    skipped_at = CASE WHEN $5::boolean THEN now() END, skipped_by_employee_id = CASE WHEN $5::boolean THEN $6::uuid END,
                    is_done = false, done_at = NULL, done_by_employee_id = NULL
              WHERE id = $1`,
            [itemId, st.id, st.name, st.color, st.closes_task, ctx.me],
          );
          await event(db, run, 'ITEM_SUB_STATUS', ctx.userId, { item_id: itemId, status: st.name, closes: st.closes_task });
          item.sub_status_id = st.id;
          item.is_done = false;
          outcome = true;
        }
      } else if (item.sub_status_name) {
        await db.query(`UPDATE ckl.run_items SET ${CLEAR_SUB_STATUS} WHERE id = $1`, [itemId]);
        await event(db, run, 'ITEM_STATUS_CLEARED', ctx.userId, { item_id: itemId, status: item.sub_status_name });
        item.sub_status_id = null;
        outcome = true;
      }
    }
    if (body.is_done !== undefined && body.is_done !== item.is_done) {
      if (body.is_done && item.require_photo && item.photo_count === 0) {
        throw unprocessable('Add a photo before ticking this item', 'PHOTO_REQUIRED', { item_ids: [itemId] });
      }
      await db.query(
        `UPDATE ckl.run_items
            SET is_done = $2, done_at = CASE WHEN $2 THEN now() END,
                done_by_employee_id = CASE WHEN $2 THEN $3::uuid END,
                is_skipped = CASE WHEN $2 THEN false ELSE is_skipped END,
                skip_reason = CASE WHEN $2 THEN NULL ELSE skip_reason END,
                skipped_at = CASE WHEN $2 THEN NULL ELSE skipped_at END,
                skipped_by_employee_id = CASE WHEN $2 THEN NULL ELSE skipped_by_employee_id END,
                sub_status_id = CASE WHEN $2 THEN NULL ELSE sub_status_id END,
                sub_status_name = CASE WHEN $2 THEN NULL ELSE sub_status_name END,
                sub_status_color = CASE WHEN $2 THEN NULL ELSE sub_status_color END,
                sub_status_closes = CASE WHEN $2 THEN false ELSE sub_status_closes END,
                sub_status_at = CASE WHEN $2 THEN NULL ELSE sub_status_at END,
                sub_status_by_employee_id = CASE WHEN $2 THEN NULL ELSE sub_status_by_employee_id END
          WHERE id = $1`,
        [itemId, body.is_done, ctx.me],
      );
      await event(db, run, body.is_done ? 'ITEM_DONE' : 'ITEM_UNDONE', ctx.userId, { item_id: itemId });
      outcome = true;
    }
    if (outcome) {
      await settleStatus(db, run, ctx.me);
      changed = true;
    }
    return changed;
  }, { actorUserId: ctx.userId });
  return detail(tenant, id, { ...ctx, canRead: true });
}

async function addPhotos(tenant, id, itemId, uploaded, ctx, fileCtx) {
  if (!uploaded.length) throw badRequest('No photos', 'NO_FILES');
  // Checks before the upload (no orphan files for a refused request) …
  await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    mayAct(run, ctx);
    checkItemsEditable(run);
    const { rows: [item] } = await db.query(
      `SELECT (SELECT count(*) FROM ckl.run_item_photos p WHERE p.run_item_id = i.id) AS n
         FROM ckl.run_items i WHERE i.id = $1 AND i.run_id = $2`,
      [itemId, id],
    );
    if (!item) throw notFound('Item not found');
    if (item.n + uploaded.length > MAX_PHOTOS_PER_ITEM) {
      throw unprocessable(`At most ${MAX_PHOTOS_PER_ITEM} photos per item`, 'TOO_MANY_PHOTOS');
    }
  });
  const stored = await files.upload(fileCtx, { module: FILE_MODULE, entityId: id, category: 'photos', files: uploaded });
  try {
    // … and again under the lock, since the run may have changed meanwhile.
    await withTransaction(async (db) => {
      const run = await locked(db, tenant, id);
      checkItemsEditable(run);
      const { rows: [{ n }] } = await db.query('SELECT count(*) AS n FROM ckl.run_item_photos WHERE run_item_id = $1', [itemId]);
      if (n + stored.length > MAX_PHOTOS_PER_ITEM) throw unprocessable(`At most ${MAX_PHOTOS_PER_ITEM} photos per item`, 'TOO_MANY_PHOTOS');
      for (let i = 0; i < stored.length; i++) {
        await db.query(
          `INSERT INTO ckl.run_item_photos (run_item_id, file_id, file_name, uploaded_by_user_id) VALUES ($1, $2, $3, $4)`,
          [itemId, stored[i].file_id, String(stored[i].original_name || uploaded[i].originalname || 'photo').slice(0, 255), ctx.userId],
        );
      }
      await event(db, run, 'PHOTO_ADDED', ctx.userId, { item_id: itemId, count: stored.length });
    }, { actorUserId: ctx.userId });
  } catch (err) {
    files.quietly(files.remove(fileCtx, stored.map((f) => f.file_id)));
    throw err;
  }
  return detail(tenant, id, { ...ctx, canRead: true });
}

// Only while the run is open. Removing the last photo of a ticked photo-required
// item un-ticks it, so "done" always has its proof.
async function removePhoto(tenant, id, itemId, photoId, ctx, fileCtx) {
  const fileId = await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    mayAct(run, ctx);
    checkItemsEditable(run);
    const { rows: [p] } = await db.query(
      `DELETE FROM ckl.run_item_photos p USING ckl.run_items i
        WHERE p.id = $1 AND p.run_item_id = i.id AND i.id = $2 AND i.run_id = $3
        RETURNING p.file_id, i.require_photo, i.is_done,
                  (SELECT count(*) FROM ckl.run_item_photos x WHERE x.run_item_id = i.id AND x.id <> p.id) AS left_count`,
      [photoId, itemId, id],
    );
    if (!p) throw notFound('Photo not found');
    if (p.require_photo && p.is_done && p.left_count === 0) {
      await db.query('UPDATE ckl.run_items SET is_done = false, done_at = NULL, done_by_employee_id = NULL WHERE id = $1', [itemId]);
      await event(db, run, 'ITEM_UNDONE', ctx.userId, { item_id: itemId, reason: 'photo_removed' });
      await settleStatus(db, run, ctx.me);
    }
    return p.file_id;
  }, { actorUserId: ctx.userId });
  files.quietly(files.remove(fileCtx, [fileId]));
  return detail(tenant, id, { ...ctx, canRead: true });
}

// ── run actions ────────────────────────────────────────────────────────────
async function completeAll(tenant, id, rowVersion, ctx) {
  await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    mayAct(run, ctx);
    checkVersion(run, rowVersion);
    checkOpen(run);
    const { rows: noPhoto } = await db.query(
      `SELECT i.id FROM ckl.run_items i
        WHERE i.run_id = $1 AND i.require_photo AND NOT i.is_done AND NOT i.is_skipped
          AND NOT EXISTS (SELECT 1 FROM ckl.run_item_photos p WHERE p.run_item_id = i.id)
        ORDER BY i.position`,
      [id],
    );
    if (noPhoto.length) {
      throw unprocessable('Some items need a photo first', 'PHOTO_REQUIRED', { item_ids: noPhoto.map((r) => r.id) });
    }
    const { rows: ticked } = await db.query(
      // Open tasks (a label-only status included) are ticked; ones closed by a status stay as they are.
      `UPDATE ckl.run_items SET is_done = true, done_at = now(), done_by_employee_id = $2::uuid, ${CLEAR_SUB_STATUS}
        WHERE run_id = $1 AND NOT is_done AND NOT is_skipped RETURNING id`,
      [id, ctx.me],
    );
    for (const t of ticked) await event(db, run, 'ITEM_DONE', ctx.userId, { item_id: t.id, via: 'complete_all' });
    await settleStatus(db, run, ctx.me);
  }, { actorUserId: ctx.userId });
  return detail(tenant, id, { ...ctx, canRead: true });
}

// Hand the run in again (e.g. after a reviewer sent it back). Every task must be closed:
// done, or can't do with a reason. There is no partial hand-in.
async function submit(tenant, id, rowVersion, ctx) {
  await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    mayAct(run, ctx);
    checkVersion(run, rowVersion);
    checkOpen(run);
    if (run.done_items < run.total_items) {
      throw unprocessable("Close every task first: tick it done, or give it a status that closes it", 'ITEMS_OPEN');
    }
    const status = run.requires_review ? 'PENDING_REVIEW' : 'COMPLETED';
    await db.query(
      `UPDATE ckl.runs
          SET status = $2::text,
              started_at = COALESCE(started_at, now()),
              submitted_at = now(),
              completed_at = CASE WHEN $2::text = 'COMPLETED' THEN now() END,${SUBMITTED_BY('$2::text', '$3::uuid')}
              row_version = row_version + 1
        WHERE id = $1`,
      [id, status, ctx.me || null],
    );
  }, { actorUserId: ctx.userId });
  return detail(tenant, id, { ...ctx, canRead: true });
}

// The reviewer, or checklist:edit. Nobody approves their own run.
async function review(tenant, id, body, ctx) {
  await withTransaction(async (db) => {
    const run = await locked(db, tenant, id);
    if (!(ctx.canEdit || (ctx.me && ctx.me === run.reviewer_employee_id))) {
      throw forbidden('Only the review approver or a manager can review this checklist');
    }
    if (ctx.me && (ctx.me === run.assignee_employee_id || ctx.me === run.submitted_by_employee_id)) {
      throw forbidden('You cannot review your own checklist', 'CANNOT_REVIEW_OWN');
    }
    checkVersion(run, body.row_version);
    if (run.status !== 'PENDING_REVIEW') throw conflict('This checklist is not waiting for review', 'RUN_NOT_PENDING_REVIEW');
    if (body.decision === 'APPROVE') {
      await db.query(
        `UPDATE ckl.runs
            SET status = 'COMPLETED', completed_at = now(), reviewed_at = now(),
                reviewed_by_employee_id = $2::uuid, review_comment = $3, row_version = row_version + 1
          WHERE id = $1`,
        [id, ctx.me, body.comment || null],
      );
    } else {
      await db.query(
        `UPDATE ckl.runs
            SET status = 'IN_PROGRESS', reviewed_by_employee_id = $2::uuid, review_comment = $3,
                rejected_count = rejected_count + 1, row_version = row_version + 1
          WHERE id = $1`,
        [id, ctx.me, body.comment],
      );
    }
  }, { actorUserId: ctx.userId });
  return detail(tenant, id, { ...ctx, canRead: true });
}

async function reassign(tenant, id, body, ctx) {
  try {
    await withTransaction(async (db) => {
      const run = await locked(db, tenant, id);
      checkVersion(run, body.row_version);
      if (!OPEN.includes(run.status)) throw unprocessable('Only open checklists can be reassigned', 'RUN_CLOSED');
      if (run.assignee_employee_id === body.employee_id) throw badRequest('Already assigned to this employee', 'SAME_ASSIGNEE');
      const { rows: [emp] } = await db.query(
        `SELECT employee_name FROM ckl.employee_directory
          WHERE zodu_id = $1 AND branch_id = $2 AND employee_id = $3 AND is_active`,
        [tenant.zodu_id, tenant.branch_id, body.employee_id],
      );
      if (!emp) throw unprocessable('That employee is not active in this branch', 'EMPLOYEE_NOT_FOUND');
      await db.query(
        `UPDATE ckl.runs SET assignee_employee_id = $2, assignee_name = $3, row_version = row_version + 1
          WHERE id = $1`,
        [id, body.employee_id, emp.employee_name],
      );
    }, { actorUserId: ctx.userId });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uq_run_slot') {
      throw conflict('That employee already has this checklist for the same time', 'ALREADY_HAS_RUN');
    }
    throw err;
  }
  return detail(tenant, id, { ...ctx, canRead: true });
}

module.exports = {
  list, summary, reviewQueue, detail, updateItem, addPhotos, removePhoto, completeAll, submit, review, reassign,
};
