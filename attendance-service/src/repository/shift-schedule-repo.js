const db = require('../database/connection');
const { inTransaction } = require('../database/transaction');

// The shift schedule of a branch (Shift Allocation Engine → Schedule Shifts): tbl_shift_assignments, one row per
// employee per day. Its primary key (zodu_id, branch_id, employee_id, work_date) serves every query here: the grid
// is a range scan on it for one page of employees, and Assign Shifts upserts on it. Employees are not in this
// database (employee-service's), so the caller passes the employee ids.

/** The scheduled cells of these employees from `from` to `to` (inclusive), each with its shift's code and name. */
exports.cells = async ({ zodu_id, branch_id, employee_ids, from, to }) => {
  if (!employee_ids.length) return [];
  const { rows } = await db.query(
    `SELECT a.employee_id,
            TO_CHAR(a.work_date, 'YYYY-MM-DD') AS work_date,
            a.shift_template_id, a.version, st.code, st.name, st.is_active
       FROM tbl_shift_assignments a
       LEFT JOIN tbl_shift_templates st ON st.shift_template_id = a.shift_template_id
      WHERE a.zodu_id = $1 AND a.branch_id = $2
        AND a.employee_id = ANY($3::uuid[])
        AND a.work_date BETWEEN $4::date AND $5::date`,
    [zodu_id, branch_id, employee_ids, from, to]
  );
  return rows;
};

/**
 * One employee's scheduled days from `from` to `to` (inclusive), each with its shift's times and the rotation that
 * produced it. A single range scan on the primary key (zodu_id, branch_id, employee_id, work_date): at most a few dozen
 * rows, joined to the shift template and rotation by their primary keys. The times are formatted here ("02:00 PM"),
 * so the service and the screen convert nothing.
 */
exports.myDays = async ({ zodu_id, branch_id, employee_id, from, to }) => {
  const { rows } = await db.query(
    `SELECT TO_CHAR(a.work_date, 'YYYY-MM-DD') AS work_date,
            a.shift_template_id, a.rotation_id,
            st.code, st.name, st.is_active, st.working_minutes,
            TO_CHAR(st.start_time, 'HH12:MI AM') AS start_time_label,
            TO_CHAR(st.end_time,   'HH12:MI AM') AS end_time_label,
            CASE WHEN st.break_minutes > 0 AND st.break_start IS NOT NULL
                 THEN TO_CHAR(st.break_start, 'HH12:MI AM') || ' – '
                      || TO_CHAR(st.break_start + make_interval(mins => st.break_minutes::int), 'HH12:MI AM')
            END AS break_label,
            st.break_minutes,
            r.name AS rotation_name, r.rotation_type, r.cycle_length,
            TO_CHAR(r.effective_from, 'YYYY-MM-DD') AS rotation_effective_from
       FROM tbl_shift_assignments a
       LEFT JOIN tbl_shift_templates st ON st.shift_template_id = a.shift_template_id
       LEFT JOIN tbl_shift_rotations r  ON r.rotation_id = a.rotation_id
      WHERE a.zodu_id = $1 AND a.branch_id = $2 AND a.employee_id = $3
        AND a.work_date BETWEEN $4::date AND $5::date
      ORDER BY a.work_date`,
    [zodu_id, branch_id, employee_id, from, to]
  );
  return rows;
};

/** The branch's shift templates among `ids` (a template of another branch is simply not returned). */
exports.findTemplates = async ({ zodu_id, branch_id, ids }) => {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT shift_template_id, code, name, is_active
       FROM tbl_shift_templates
      WHERE zodu_id = $1 AND branch_id = $2 AND shift_template_id = ANY($3::uuid[])`,
    [zodu_id, branch_id, ids]
  );
  return rows;
};

// The cells' keys as parallel arrays, for unnest().
const arraysOf = (cells) => [
  cells.map((c) => c.employee_id),
  cells.map((c) => c.work_date),
  cells.map((c) => c.shift_template_id),
  cells.map((c) => c.version),
];

/**
 * Save the cells in one transaction (all or nothing), one statement for the whole batch.
 *
 * Each cell carries the version the screen loaded (0 = it was empty). The statement inserts the cell, or updates it
 * only if its version is still that one: the check and the write are the same statement, so two admins saving the same
 * cell at once can't both win (the second waits for the first's row lock, then finds the version moved). If any cell
 * is not saved the whole batch is rolled back and null is returned; the service then reports which cells conflict.
 *
 * The cells are written in (employee, date) order, so two overlapping batches take their row locks in the same
 * order and can't deadlock.
 */
exports.assign = async ({ zodu_id, branch_id, cells, updated_by }) => {
  const sorted = [...cells].sort((a, b) =>
    a.employee_id.localeCompare(b.employee_id) || a.work_date.localeCompare(b.work_date));

  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tbl_shift_assignments AS a
         (zodu_id, branch_id, employee_id, work_date, shift_template_id, source, version, updated_by)
       SELECT $1::varchar, $2::varchar, i.employee_id, i.work_date, i.shift_template_id, 'MANUAL', i.expected_version + 1, $7::varchar
         FROM unnest($3::uuid[], $4::date[], $5::uuid[], $6::int[])
              AS i(employee_id, work_date, shift_template_id, expected_version)
        -- (the casts on $1 / $2 / $7: one parameter used as a value and in a comparison needs one stated type)
        -- a cell that was loaded with a version must still exist; an empty one (0) is inserted
        WHERE i.expected_version = 0
           OR EXISTS (SELECT 1 FROM tbl_shift_assignments x
                       WHERE x.zodu_id = $1::varchar AND x.branch_id = $2::varchar
                         AND x.employee_id = i.employee_id AND x.work_date = i.work_date)
       ON CONFLICT (zodu_id, branch_id, employee_id, work_date) DO UPDATE
          SET shift_template_id = EXCLUDED.shift_template_id,
              source      = 'MANUAL',
              rotation_id = NULL,
              version     = a.version + 1,
              updated_by  = EXCLUDED.updated_by,
              updated_at  = NOW()
        WHERE a.version = EXCLUDED.version - 1
       RETURNING a.employee_id, TO_CHAR(a.work_date, 'YYYY-MM-DD') AS work_date, a.shift_template_id, a.version`,
      [zodu_id, branch_id, ...arraysOf(sorted), updated_by ?? null]
    );
    return rows.length === sorted.length ? rows : null;
  });
};

/** The current state of these cells (to tell the screen which ones changed under it). Cells never scheduled are absent. */
exports.currentCells = async ({ zodu_id, branch_id, cells }) => {
  const [employee_ids, dates] = arraysOf(cells);
  const { rows } = await db.query(
    `SELECT a.employee_id, TO_CHAR(a.work_date, 'YYYY-MM-DD') AS work_date, a.shift_template_id, a.version, st.code
       FROM unnest($3::uuid[], $4::date[]) AS i(employee_id, work_date)
       JOIN tbl_shift_assignments a
         ON a.zodu_id = $1 AND a.branch_id = $2 AND a.employee_id = i.employee_id AND a.work_date = i.work_date
       LEFT JOIN tbl_shift_templates st ON st.shift_template_id = a.shift_template_id`,
    [zodu_id, branch_id, employee_ids, dates]
  );
  return rows;
};
