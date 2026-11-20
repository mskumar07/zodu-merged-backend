const db = require('../database/connection');
const { likeOf } = require('../utils/sql');

// Leave types of a branch (the Leave Settings → Leave Types screen). Every query leads with
// (zodu_id, branch_id), which is what uq_leave_types_branch_code is built on, so each one is an index lookup;
// a branch has a handful of types, so the list is never paged.

// One leave type, ready to show: numbers as numbers, the date as YYYY-MM-DD.
const COLUMNS = `
  leave_type_id, code, name,
  annual_days::float8              AS annual_days,
  is_paid, carry_forward,
  carry_forward_max_days::float8   AS carry_forward_max_days,
  encashment, applicable_to, department_ids,
  TO_CHAR(effective_from, 'YYYY-MM-DD') AS effective_from,
  is_active, sort_order`;

/**
 * A branch that has no leave types at all gets the defaults (CL / SL / PL / EL). This used to be a trigger on the
 * branch's first employee; employees now live in employee-service, so the branch's first read does it. One index
 * lookup once the branch has types, and ON CONFLICT DO NOTHING makes two requests at once harmless.
 */
const seeded = new Set(); // branches known to have leave types: after the first check, no extra query per request
const ensureDefaults = async ({ zodu_id, branch_id }) => {
  const key = `${zodu_id}|${branch_id}`;
  if (seeded.has(key)) return;
  await db.query(
    `SELECT fn_seed_default_leave_types($1, $2)
     WHERE NOT EXISTS (SELECT 1 FROM tbl_leave_types WHERE zodu_id = $1 AND branch_id = $2)`,
    [zodu_id, branch_id]
  );
  seeded.add(key);
};
exports.ensureDefaults = ensureDefaults;

/** The branch's leave types in their screen order. status: true = active only, false = inactive only, null = all. */
exports.list = async ({ zodu_id, branch_id, is_active = null, search }) => {
  await ensureDefaults({ zodu_id, branch_id });
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM tbl_leave_types
     WHERE zodu_id = $1 AND branch_id = $2
       AND ($3::boolean IS NULL OR is_active = $3)
       AND ($4::text IS NULL OR name ILIKE $4 OR code ILIKE $4)
     ORDER BY sort_order, code`,
    [zodu_id, branch_id, is_active, likeOf(search)]
  );
  return rows;
};

/** One leave type of this branch, or null (someone else's type looks the same as a missing one). */
exports.findById = async ({ zodu_id, branch_id, leave_type_id }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tbl_leave_types
     WHERE leave_type_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [leave_type_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

/**
 * Add a leave type, last in the order. The next position is worked out inside the same statement, so it
 * costs no extra round trip. A code already used in the branch raises 23505.
 */
exports.insert = async (t) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_leave_types (
       zodu_id, branch_id, code, name, annual_days, is_paid, carry_forward, carry_forward_max_days,
       encashment, applicable_to, department_ids, effective_from, is_active, sort_order
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tbl_leave_types WHERE zodu_id = $14 AND branch_id = $15))
     RETURNING ${COLUMNS}`,
    // zodu_id / branch_id are sent twice (as $1 / $2 and as $14 / $15): one parameter can't be both a column value
    // and a comparison, because Postgres deduces a type for each use.
    [t.zodu_id, t.branch_id, t.code, t.name, t.annual_days, t.is_paid, t.carry_forward, t.carry_forward_max_days,
      t.encashment, t.applicable_to, t.department_ids, t.effective_from, t.is_active, t.zodu_id, t.branch_id]
  );
  return rows[0];
};

/** Save every editable field of a leave type (the service has already merged the change into the row). Null if not found. */
exports.update = async (t) => {
  const { rows } = await db.query(
    `UPDATE tbl_leave_types
        SET code = $4, name = $5, annual_days = $6, is_paid = $7, carry_forward = $8, carry_forward_max_days = $9,
            encashment = $10, applicable_to = $11, department_ids = $12, effective_from = $13,
            is_active = $14, updated_at = NOW()
      WHERE leave_type_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING ${COLUMNS}`,
    [t.leave_type_id, t.zodu_id, t.branch_id, t.code, t.name, t.annual_days, t.is_paid, t.carry_forward,
      t.carry_forward_max_days, t.encashment, t.applicable_to, t.department_ids, t.effective_from, t.is_active]
  );
  return rows[0] || null;
};

/** Switch a leave type off (what "Delete" does). Already off is fine. Null if not found. */
exports.deactivate = async ({ zodu_id, branch_id, leave_type_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_leave_types
        SET is_active = FALSE, updated_at = NOW()
      WHERE leave_type_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING ${COLUMNS}`,
    [leave_type_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};
