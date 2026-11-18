const db = require('../database/connection');
const { likeOf } = require('../utils/sql');

// Shift templates of a branch (Shift Allocation Engine → Shift Templates). Every query leads with
// (zodu_id, branch_id), which uq_shift_templates_branch_code is built on, so each one is an index lookup;
// a branch has a handful of templates, so the list is never paged.

// One template, ready to show. Each time comes twice: "HH:mm" (24-hour) for the edit form's inputs, and a
// *_label for display ("09:00 AM", "7h 00m", "01:00 PM – 02:00 PM"), so the client converts nothing.
const COLUMNS = `
  shift_template_id, code, name, description,
  TO_CHAR(start_time, 'HH24:MI')  AS start_time,
  TO_CHAR(start_time, 'HH12:MI AM') AS start_time_label,
  TO_CHAR(end_time,   'HH24:MI')  AS end_time,
  TO_CHAR(end_time,   'HH12:MI AM') AS end_time_label,
  is_cross_day,
  TO_CHAR(break_start, 'HH24:MI') AS break_start,
  CASE
    WHEN break_start IS NOT NULL THEN
      TO_CHAR(break_start, 'HH12:MI AM') || ' – ' || TO_CHAR(break_start + make_interval(mins => break_minutes::int), 'HH12:MI AM')
    WHEN break_minutes > 0 THEN (break_minutes / 60) || 'h ' || LPAD((break_minutes % 60)::text, 2, '0') || 'm'
  END AS break_label,
  break_minutes, working_minutes,
  (working_minutes / 60) || 'h ' || LPAD((working_minutes % 60)::text, 2, '0') || 'm' AS working_hours_label,
  applicable_to, department_ids, ot_eligible, is_active, sort_order`;

/** The branch's templates in their screen order. is_active: true = active only, false = inactive only, null = all. */
exports.list = async ({ zodu_id, branch_id, is_active = null, search }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM tbl_shift_templates
     WHERE zodu_id = $1 AND branch_id = $2
       AND ($3::boolean IS NULL OR is_active = $3)
       AND ($4::text IS NULL OR name ILIKE $4 OR code ILIKE $4)
     ORDER BY sort_order, code`,
    [zodu_id, branch_id, is_active, likeOf(search)]
  );
  return rows;
};

/** One template of this branch, or null (someone else's template looks the same as a missing one). */
exports.findById = async ({ zodu_id, branch_id, shift_template_id }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tbl_shift_templates
     WHERE shift_template_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [shift_template_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

/**
 * Add a template, last in the order (the next position is worked out inside the same statement). A code or a
 * name already used in the branch raises 23505.
 */
exports.insert = async (t) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_shift_templates (
       zodu_id, branch_id, code, name, description, start_time, end_time, is_cross_day, break_start, break_minutes,
       working_minutes, applicable_to, department_ids, ot_eligible, is_active, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tbl_shift_templates WHERE zodu_id = $16 AND branch_id = $17))
     RETURNING ${COLUMNS}`,
    // zodu_id / branch_id are sent twice ($1/$2 and $16/$17): one parameter can't be both a column value and a
    // comparison, because Postgres deduces a type for each use.
    [t.zodu_id, t.branch_id, t.code, t.name, t.description, t.start_time, t.end_time, t.is_cross_day, t.break_start,
      t.break_minutes, t.working_minutes, t.applicable_to, t.department_ids, t.ot_eligible, t.is_active,
      t.zodu_id, t.branch_id]
  );
  return rows[0];
};

/** Save every editable field (the service has already merged the change into the row). Null if not found. */
exports.update = async (t) => {
  const { rows } = await db.query(
    `UPDATE tbl_shift_templates
        SET code = $4, name = $5, description = $6, start_time = $7, end_time = $8, is_cross_day = $9,
            break_start = $10, break_minutes = $11, working_minutes = $12, applicable_to = $13, department_ids = $14,
            ot_eligible = $15, is_active = $16, updated_at = NOW()
      WHERE shift_template_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING ${COLUMNS}`,
    [t.shift_template_id, t.zodu_id, t.branch_id, t.code, t.name, t.description, t.start_time, t.end_time,
      t.is_cross_day, t.break_start, t.break_minutes, t.working_minutes, t.applicable_to, t.department_ids,
      t.ot_eligible, t.is_active]
  );
  return rows[0] || null;
};

/** Switch a template off (what "Delete" does). Already off is fine. Null if not found. */
exports.deactivate = async ({ zodu_id, branch_id, shift_template_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_shift_templates
        SET is_active = FALSE, updated_at = NOW()
      WHERE shift_template_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING ${COLUMNS}`,
    [shift_template_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};
