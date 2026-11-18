const db = require('../database/connection');
const { likeOf } = require('../utils/sql');

// Holidays of a branch (Leave → Holidays). Every query leads with (zodu_id, branch_id, holiday_date), which is
// exactly what uq_holidays_branch_date is built on, so a year is one index range scan. A branch has a few dozen
// holidays a year, so the list is never paged. The Excel import and the Leave screen keep using leave-repo.js.

// One holiday, ready to show: dates and day name already formatted, the type as stored.
const COLUMNS = `
  holiday_id, name,
  TO_CHAR(holiday_date, 'YYYY-MM-DD') AS holiday_date,
  TO_CHAR(holiday_date, 'DD Mon YYYY') AS date_label,
  TO_CHAR(holiday_date, 'Dy')          AS day,
  holiday_type AS type,
  applicable_to,
  CASE applicable_to WHEN 'ALL' THEN 'All Employees' ELSE 'Selected Departments' END AS applicable_label,
  department_ids`;

/** The year's holidays, by date. `type` (the exact stored value) narrows it, `search` matches the name. */
exports.list = async ({ zodu_id, branch_id, from, to, type = null, search }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM tbl_holidays
     WHERE zodu_id = $1 AND branch_id = $2 AND holiday_date >= $3::date AND holiday_date < $4::date
       AND ($5::text IS NULL OR holiday_type = $5)
       AND ($6::text IS NULL OR name ILIKE $6)
     ORDER BY holiday_date`,
    [zodu_id, branch_id, from, to, type, likeOf(search)]
  );
  return rows;
};

/** How many holidays of each type the year has: [{ type, count }] (the numbers beside the left-hand list). */
exports.counts = async ({ zodu_id, branch_id, from, to }) => {
  const { rows } = await db.query(
    `SELECT holiday_type AS type, COUNT(*)::int AS count
     FROM tbl_holidays
     WHERE zodu_id = $1 AND branch_id = $2 AND holiday_date >= $3::date AND holiday_date < $4::date
     GROUP BY holiday_type
     ORDER BY holiday_type`,
    [zodu_id, branch_id, from, to]
  );
  return rows;
};

/** One holiday of this branch, or null (someone else's holiday looks the same as a missing one). */
exports.findById = async ({ zodu_id, branch_id, holiday_id }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tbl_holidays WHERE holiday_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [holiday_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

/** Add a holiday, noting who added it (created_by). A date already taken in the branch raises 23505. */
exports.insert = async (h) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_holidays (zodu_id, branch_id, holiday_date, name, holiday_type, applicable_to, department_ids, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [h.zodu_id, h.branch_id, h.holiday_date, h.name, h.type, h.applicable_to, h.department_ids, h.created_by ?? null]
  );
  return rows[0];
};

/** Save every editable field (the service has already merged the change into the row). Null if not found. */
exports.update = async (h) => {
  const { rows } = await db.query(
    `UPDATE tbl_holidays
        SET holiday_date = $4, name = $5, holiday_type = $6, applicable_to = $7, department_ids = $8, updated_at = NOW()
      WHERE holiday_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING ${COLUMNS}`,
    [h.holiday_id, h.zodu_id, h.branch_id, h.holiday_date, h.name, h.type, h.applicable_to, h.department_ids]
  );
  return rows[0] || null;
};

/** Remove a holiday. Nothing points at it (leave days are worked out from the table when a leave is applied). Null if not found. */
exports.remove = async ({ zodu_id, branch_id, holiday_id }) => {
  const { rows } = await db.query(
    `DELETE FROM tbl_holidays WHERE holiday_id = $1 AND zodu_id = $2 AND branch_id = $3 RETURNING ${COLUMNS}`,
    [holiday_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};
