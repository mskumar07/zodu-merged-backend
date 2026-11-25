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

