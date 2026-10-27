const db = require('../database/connection');

// ── REGISTER  (one face per employee — re-registering replaces it) ───────────

exports.upsertFace = async ({ employee_id, zodu_id, branch_id, embedding }) => {
  const { rows } = await db.query(
    `INSERT INTO tbl_employee_faces (employee_id, zodu_id, branch_id, embedding)
     VALUES ($1, $2, $3, $4::real[])
     ON CONFLICT (employee_id) DO UPDATE SET
       zodu_id    = EXCLUDED.zodu_id,
       branch_id  = EXCLUDED.branch_id,
       embedding  = EXCLUDED.embedding,
       updated_at = NOW()
     RETURNING employee_id, created_at, updated_at`,
    [employee_id, zodu_id, branch_id, embedding]
  );
  return rows[0];
};

exports.findFaceStatus = async (employee_id) => {
  const { rows } = await db.query(
    `SELECT employee_id, created_at, updated_at
     FROM tbl_employee_faces WHERE employee_id = $1`,
    [employee_id]
  );
  return rows[0] || null;
};

exports.deleteFace = async (employee_id) => {
  const { rowCount } = await db.query(
    `DELETE FROM tbl_employee_faces WHERE employee_id = $1`,
    [employee_id]
  );
  return rowCount > 0;
};

// ── CANDIDATES FOR MATCHING  (active staff of one branch with a face) ─────────
// [employee_id] narrows it to one person when the app already knows who is
// punching; otherwise every registered face in the branch is a candidate.

exports.findCandidates = async ({ zodu_id, branch_id, employee_id }) => {
  const params = [zodu_id, branch_id];
  let filter = '';
  if (employee_id) {
    params.push(employee_id);
    filter = 'AND f.employee_id = $3';
  }
  const { rows } = await db.query(
    `SELECT f.employee_id, f.embedding, e.name AS employee_name, e.employee_code
     FROM tbl_employee_faces f
     JOIN tbl_employees e ON e.employee_id = f.employee_id
     WHERE e.zodu_id = $1 AND e.branch_id = $2 AND e.status = 'active' ${filter}`,
    params
  );
  return rows;
};

exports.findEmployee = async ({ employee_id, zodu_id, branch_id }) => {
  const { rows } = await db.query(
    `SELECT employee_id, name, status FROM tbl_employees
     WHERE employee_id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [employee_id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

// ── PUNCH  (today's row, locked so two quick scans can't both check in) ──────

exports.findTodayForUpdate = async (client, { employee_id, attendance_date }) => {
  const { rows } = await client.query(
    `SELECT status, check_in_time, check_out_time
     FROM tbl_attendance
     WHERE employee_id = $1 AND attendance_date = $2::date
     FOR UPDATE`,
    [employee_id, attendance_date]
  );
  return rows[0] || null;
};

exports.checkIn = async (client, d) => {
  const { rows } = await client.query(
    `INSERT INTO tbl_attendance (
       zodu_id, branch_id, employee_id, attendance_date, status,
       check_in_time, marked_by, marked_by_name, remarks
     ) VALUES ($1, $2, $3, $4::date, 'Present', NOW(), $5, $6, 'Face check-in')
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status         = 'Present',
       check_in_time  = NOW(),
       check_out_time = NULL,
       marked_by      = EXCLUDED.marked_by,
       marked_by_name = EXCLUDED.marked_by_name,
       remarks        = EXCLUDED.remarks,
       updated_at     = NOW()
     RETURNING TO_CHAR(check_in_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_time`,
    [d.zodu_id, d.branch_id, d.employee_id, d.attendance_date, d.marked_by, d.marked_by_name]
  );
  return rows[0];
};

exports.checkOut = async (client, { employee_id, attendance_date }) => {
  const { rows } = await client.query(
    `UPDATE tbl_attendance
     SET check_out_time = NOW(), updated_at = NOW()
     WHERE employee_id = $1 AND attendance_date = $2::date
     RETURNING
       TO_CHAR(check_in_time  AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_time,
       TO_CHAR(check_out_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_time`,
    [employee_id, attendance_date]
  );
  return rows[0];
};
