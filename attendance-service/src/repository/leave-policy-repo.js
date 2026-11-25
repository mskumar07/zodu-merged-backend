const db = require('../database/connection');
const { likeOf } = require('../utils/sql');

// Leave policies of a branch (Leave → Leave Policy). Every query leads with (zodu_id, branch_id) and a live row
// (deleted_at IS NULL), which is exactly what idx_leave_policies_branch_created is built on, so each one is an
// index lookup. A branch has a handful of policies, so the list is never paged and carries the full
// configuration: the details panel needs no second call.

// One policy, ready to show: numbers as numbers.
const COLUMNS = `
  policy_id, name, description, is_active,
  applicable_to, department_ids,
  annual_entitlement, leave_year_start_month,
  carry_forward, carry_forward_max_days::float8 AS carry_forward_max_days,
  encashment,    encashment_limit_days::float8  AS encashment_limit_days,
  version`;

/** The branch's policies, newest first. is_active: true = active only, false = inactive only, null = all. */
exports.list = async ({ zodu_id, branch_id, is_active = null, search }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM tbl_leave_policies
     WHERE zodu_id = $1 AND branch_id = $2 AND deleted_at IS NULL
       AND ($3::boolean IS NULL OR is_active = $3)
       AND ($4::text IS NULL OR name ILIKE $4)
     ORDER BY created_at DESC, policy_id DESC`,
    [zodu_id, branch_id, is_active, likeOf(search)]
  );
  return rows;
};

/** One policy of this branch, or null (someone else's policy looks the same as a missing or deleted one). */
exports.findById = async ({ zodu_id, branch_id, policy_id }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tbl_leave_policies
     WHERE policy_id = $1 AND zodu_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
    [policy_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

/** Add a policy. A name already used in the branch, or a second active All Employees policy, raises 23505. */
exports.insert = async (p) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_leave_policies (
       zodu_id, branch_id, name, description, is_active, applicable_to, department_ids,
       annual_entitlement, leave_year_start_month, carry_forward, carry_forward_max_days,
       encashment, encashment_limit_days, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${COLUMNS}`,
    [p.zodu_id, p.branch_id, p.name, p.description, p.is_active, p.applicable_to, p.department_ids,
      p.annual_entitlement, p.leave_year_start_month, p.carry_forward, p.carry_forward_max_days,
      p.encashment, p.encashment_limit_days, p.created_by ?? null]
  );
  return rows[0];
};

/**
 * Save every editable field (the service has already merged the change into the row), but only if the policy is
 * still at `version`: the check and the write are one statement, so two admins saving at once can't both win.
 * Null when the policy is gone or someone else saved first (the service tells the two apart).
 */
exports.update = async (p) => {
  const { rows } = await db.query(
    `UPDATE tbl_leave_policies
        SET name = $4, description = $5, is_active = $6, applicable_to = $7, department_ids = $8,
            annual_entitlement = $9, leave_year_start_month = $10, carry_forward = $11, carry_forward_max_days = $12,
            encashment = $13, encashment_limit_days = $14,
            version = version + 1, updated_at = NOW()
      WHERE policy_id = $1 AND zodu_id = $2 AND branch_id = $3 AND deleted_at IS NULL AND version = $15
      RETURNING ${COLUMNS}`,
    [p.policy_id, p.zodu_id, p.branch_id, p.name, p.description, p.is_active, p.applicable_to, p.department_ids,
      p.annual_entitlement, p.leave_year_start_month, p.carry_forward, p.carry_forward_max_days,
      p.encashment, p.encashment_limit_days, p.expected_version]
  );
  return rows[0] || null;
};

/** Make the policy inactive (what "Delete" does). The row stays in the list as inactive. Null if not found. */
exports.remove = async ({ zodu_id, branch_id, policy_id }) => {
  const { rows } = await db.query(
    `UPDATE tbl_leave_policies
        SET is_active = false, updated_at = NOW(), version = version + 1
      WHERE policy_id = $1 AND zodu_id = $2 AND branch_id = $3 AND deleted_at IS NULL
      RETURNING policy_id`,
    [policy_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};
