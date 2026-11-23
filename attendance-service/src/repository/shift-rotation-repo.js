const db = require('../database/connection');
const { likeOf } = require('../utils/sql');
const { inTransaction } = require('../database/transaction');

// Shift rotations of a branch (Shift Allocation Engine → Shift Rotation). Every query leads with (zodu_id, branch_id),
// which idx_shift_rotations_branch_created is built on, so each one is an index lookup. A branch has a handful of
// rotations, so the list is never paged; each rotation carries its days (one lateral lookup on the days' primary key),
// so the details panel needs no second call.

// Dates come out as text: "YYYY-MM-DD" for the date input, "DD-MM-YYYY" for display, "Mar 1, 2027" for the list.
// (A DATE read as a JS Date would shift by the server's time zone.)
const COLUMNS = `
  r.rotation_id, r.name, r.description, r.rotation_type, r.cycle_length, r.applicable_to, r.department_ids,
  TO_CHAR(r.effective_from, 'YYYY-MM-DD')     AS effective_from,
  TO_CHAR(r.effective_from, 'DD-MM-YYYY')     AS effective_from_label,
  TO_CHAR(r.effective_from, 'Mon FMDD, YYYY') AS effective_from_display,
  r.is_active, r.version, r.created_at, r.updated_at,
  COALESCE(d.days, '[]'::jsonb) AS days`;

// The days of a rotation in order, each with its shift's chip (code), name and times; a rest day has nulls.
const DAYS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'day_no',            rd.day_no,
             'shift_template_id', rd.shift_template_id,
             'code',              st.code,
             'name',              st.name,
             'start_time_label',  TO_CHAR(st.start_time, 'HH12:MI AM'),
             'end_time_label',    TO_CHAR(st.end_time,   'HH12:MI AM'),
             'is_active',         st.is_active
           ) ORDER BY rd.day_no) AS days
      FROM tbl_shift_rotation_days rd
      LEFT JOIN tbl_shift_templates st ON st.shift_template_id = rd.shift_template_id
     WHERE rd.rotation_id = r.rotation_id
  ) d ON TRUE`;

/** The branch's rotations, newest first. is_active: true = active only, false = inactive only, null = all. */
exports.list = async ({ zodu_id, branch_id, is_active = null, search }) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM tbl_shift_rotations r ${DAYS_JOIN}
      WHERE r.zodu_id = $1 AND r.branch_id = $2
        AND ($3::boolean IS NULL OR r.is_active = $3)
        AND ($4::text IS NULL OR r.name ILIKE $4)
      ORDER BY r.created_at DESC, r.rotation_id DESC`,
    [zodu_id, branch_id, is_active, likeOf(search)]
  );
  return rows;
};

/** One rotation of this branch, or null (someone else's rotation looks the same as a missing one). */
exports.findById = async ({ zodu_id, branch_id, rotation_id }, client = db) => {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}
       FROM tbl_shift_rotations r ${DAYS_JOIN}
      WHERE r.rotation_id = $1 AND r.zodu_id = $2 AND r.branch_id = $3`,
    [rotation_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

/** The branch's shift templates among `ids` (a template of another branch is simply not returned). */
exports.findTemplates = async ({ zodu_id, branch_id, ids }) => {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT shift_template_id, name, is_active
       FROM tbl_shift_templates
      WHERE zodu_id = $1 AND branch_id = $2 AND shift_template_id = ANY($3::uuid[])`,
    [zodu_id, branch_id, ids]
  );
  return rows;
};

/** Writes all the days of a rotation in one statement. */
const insertDays = (client, rotation_id, days) =>
  client.query(
    `INSERT INTO tbl_shift_rotation_days (rotation_id, day_no, shift_template_id)
     SELECT $1, d.day_no, d.shift_template_id
       FROM unnest($2::smallint[], $3::uuid[]) AS d(day_no, shift_template_id)`,
    [rotation_id, days.map((x) => x.day_no), days.map((x) => x.shift_template_id)]
  );

/**
 * Add a rotation and its days together (all or nothing). A name already used in the branch raises 23505.
 * Returns the saved rotation.
 */
exports.insert = async (r) => {
  const key = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tbl_shift_rotations (
         zodu_id, branch_id, name, description, rotation_type, cycle_length, applicable_to, department_ids,
         effective_from, is_active, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING rotation_id`,
      [r.zodu_id, r.branch_id, r.name, r.description, r.rotation_type, r.cycle_length, r.applicable_to,
        r.department_ids, r.effective_from, r.is_active, r.created_by ?? null]
    );
    await insertDays(client, rows[0].rotation_id, r.days);
    return { zodu_id: r.zodu_id, branch_id: r.branch_id, rotation_id: rows[0].rotation_id };
  });
  return exports.findById(key);
};

/**
 * Save every editable field (the service has already merged the change into the row) and, when `days` is given,
 * replace the pattern, but only if the rotation is still at `expected_version`: the check and the write are one
 * statement, so two admins saving at once can't both win (the second waits for the first's row lock, then finds
 * the version moved). Null when the rotation is gone or someone else saved first (the service tells the two apart).
 */
exports.update = async (r) => {
  const key = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE tbl_shift_rotations
          SET name = $4, description = $5, rotation_type = $6, cycle_length = $7, applicable_to = $8,
              department_ids = $9, effective_from = $10, is_active = $11, updated_by = $12,
              version = version + 1, updated_at = NOW()
        WHERE rotation_id = $1 AND zodu_id = $2 AND branch_id = $3 AND version = $13
        RETURNING rotation_id`,
      [r.rotation_id, r.zodu_id, r.branch_id, r.name, r.description, r.rotation_type, r.cycle_length,
        r.applicable_to, r.department_ids, r.effective_from, r.is_active, r.updated_by ?? null, r.expected_version]
    );
    if (!rows[0]) return null;
    if (r.days) {
      await client.query('DELETE FROM tbl_shift_rotation_days WHERE rotation_id = $1', [r.rotation_id]);
      await insertDays(client, r.rotation_id, r.days);
    }
    return { zodu_id: r.zodu_id, branch_id: r.branch_id, rotation_id: r.rotation_id };
  });
  return key ? exports.findById(key) : null;
};

/** Switch a rotation off (what "Delete" does). Already off is fine. Null if not found. */
exports.deactivate = async ({ zodu_id, branch_id, rotation_id, updated_by }) => {
  const { rows } = await db.query(
    `UPDATE tbl_shift_rotations
        SET is_active = FALSE, updated_by = $4, version = version + 1, updated_at = NOW()
      WHERE rotation_id = $1 AND zodu_id = $2 AND branch_id = $3
      RETURNING rotation_id`,
    [rotation_id, zodu_id, branch_id, updated_by ?? null]
  );
  return rows[0] ? exports.findById({ zodu_id, branch_id, rotation_id }) : null;
};
