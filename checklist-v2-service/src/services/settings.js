// Checklist settings for the whole company (Settings → Checklist settings):
// require photo / allow partial / allow notes and the notifications & escalation
// rules. Every checklist of the company follows them: saving rewrites each
// checklist's columns and checklist_rules (the engine reads those), and create /
// edit take them from here instead of the request.
const pool = require('../database/pool');
const { withTransaction } = require('../database/tx');
const repo = require('../repository/checklists');
const { normalizeRules } = require('./rules');
const { conflict } = require('../utils/errors');

// Same as the form's old defaults: remind 15 min before, tell the assignee when
// overdue, escalate after 60 min, tell the approver on submit.
const DEFAULT_RULES = normalizeRules([
  { rule_type: 'REMIND_BEFORE_DUE', offset_min: 15, target: 'ASSIGNEE' },
  { rule_type: 'NOTIFY_ON_OVERDUE', target: 'ASSIGNEE' },
  { rule_type: 'ESCALATE_AFTER_OVERDUE', offset_min: 60, target: 'REVIEWER' },
  { rule_type: 'NOTIFY_REVIEWER_ON_SUBMIT', target: 'REVIEWER' },
], { schedule: { task_type: 'ONCE' } });

const DEFAULTS = { require_photo: true, allow_partial: true, allow_notes: true, rules: DEFAULT_RULES };

const out = (row) => ({
  require_photo: row.require_photo,
  allow_partial: row.allow_partial,
  allow_notes: row.allow_notes,
  rules: row.rules,
  row_version: row.row_version ?? 0, // 0: never saved, these are the defaults
  updated_at: row.updated_at ?? null,
  updated_by: row.updated_by_user_id ? { user_id: row.updated_by_user_id, name: row.updated_by_name } : null,
});

async function get(zoduId, db = pool) {
  const { rows: [row] } = await db.query('SELECT * FROM ckl.company_settings WHERE zodu_id = $1', [zoduId]);
  return out(row || DEFAULTS);
}

/**
 * The company's rules as one checklist uses them:
 * - no approver: "notify the approver on submit" is dropped (nothing is ever
 *   submitted for review) and escalation goes to the creator;
 * - hourly: a reminder must come inside the interval, so a longer lead time is
 *   shortened to 5 minutes under it.
 */
function rulesForChecklist(rules, { hasReviewer, schedule }) {
  const hourly = schedule.task_type === 'RECURRING' && schedule.frequency === 'HOURLY';
  const cap = hourly ? Math.max(1, schedule.every_n || 1) * 60 : null;
  const seen = new Set();
  const result = [];
  for (const r of rules) {
    if (r.rule_type === 'NOTIFY_REVIEWER_ON_SUBMIT' && !hasReviewer) continue;
    const rule = {
      ...r,
      threshold: r.threshold ?? null,
      target_employee_ids: [],
      channels: r.channels?.length ? r.channels : ['IN_APP'],
      is_active: r.is_active !== false,
    };
    if (rule.rule_type === 'ESCALATE_AFTER_OVERDUE' && rule.target === 'REVIEWER' && !hasReviewer) rule.target = 'CREATOR';
    if (rule.rule_type === 'REMIND_BEFORE_DUE' && cap !== null && rule.offset_min >= cap) rule.offset_min = Math.max(5, cap - 5);
    const key = `${rule.rule_type}|${rule.offset_min}|${rule.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rule);
  }
  return result;
}

// Save and apply to every checklist of the company (all branches). Rules apply to
// open runs at once (the engine reads them live); the photo / notes / partial
// switches also update open runs, on items nobody has ticked yet.
async function update(tenant, actor, body) {
  const rules = normalizeRules(body.rules, { schedule: { task_type: 'ONCE' } });
  return withTransaction(async (db) => {
    const { rows: [current] } = await db.query(
      'SELECT row_version FROM ckl.company_settings WHERE zodu_id = $1 FOR UPDATE',
      [tenant.zodu_id],
    );
    const version = current?.row_version ?? 0;
    if (version !== body.row_version) {
      throw conflict('These settings were changed by someone else', 'SETTINGS_VERSION_CONFLICT', { row_version: version });
    }
    const { rows: [named] } = await db.query(
      'SELECT employee_name FROM ckl.employee_directory WHERE user_id = $1 AND zodu_id = $2 LIMIT 1',
      [actor.userId, tenant.zodu_id],
    );
    await db.query(
      `INSERT INTO ckl.company_settings (zodu_id, require_photo, allow_partial, allow_notes, rules, updated_by_user_id, updated_by_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (zodu_id) DO UPDATE
         SET require_photo = EXCLUDED.require_photo, allow_partial = EXCLUDED.allow_partial,
             allow_notes = EXCLUDED.allow_notes, rules = EXCLUDED.rules,
             updated_by_user_id = EXCLUDED.updated_by_user_id, updated_by_name = EXCLUDED.updated_by_name,
             row_version = ckl.company_settings.row_version + 1`,
      [tenant.zodu_id, body.require_photo, body.allow_partial, body.allow_notes, JSON.stringify(rules),
        actor.userId, named?.employee_name || 'User'],
    );

    const { rows: checklists } = await db.query(
      `SELECT c.id, c.reviewer_employee_id, s.task_type, s.frequency, s.every_n
         FROM ckl.checklists c JOIN ckl.checklist_schedules s ON s.checklist_id = c.id
        WHERE c.zodu_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.id
        FOR UPDATE OF c`,
      [tenant.zodu_id],
    );
    for (const c of checklists) {
      await db.query(
        `UPDATE ckl.checklists SET require_photo = $2, allow_partial = $3, allow_notes = $4, row_version = row_version + 1
          WHERE id = $1`,
        [c.id, body.require_photo, body.allow_partial, body.allow_notes],
      );
      await repo.syncRules(db, c.id, rulesForChecklist(rules, { hasReviewer: Boolean(c.reviewer_employee_id), schedule: c }));
    }

    await db.query(
      `UPDATE ckl.runs SET allow_partial = $2
        WHERE zodu_id = $1 AND status IN ('TODO','IN_PROGRESS') AND allow_partial <> $2`,
      [tenant.zodu_id, body.allow_partial],
    );
    await db.query(
      `UPDATE ckl.run_items i
          SET require_photo = tk.require_photo AND $2, allow_notes = tk.allow_notes AND $3
         FROM ckl.runs r, ckl.checklist_tasks tk
        WHERE i.run_id = r.id AND r.zodu_id = $1 AND r.status IN ('TODO','IN_PROGRESS') AND NOT i.is_done
          AND tk.checklist_id = r.checklist_id AND tk.position = i.position AND tk.title = i.title
          AND (i.require_photo <> (tk.require_photo AND $2) OR i.allow_notes <> (tk.allow_notes AND $3))`,
      [tenant.zodu_id, body.require_photo, body.allow_notes],
    );
    return { ...(await get(tenant.zodu_id, db)), applied_to: checklists.length };
  }, { actorUserId: actor.userId });
}

module.exports = { get, update, rulesForChecklist, DEFAULTS };
