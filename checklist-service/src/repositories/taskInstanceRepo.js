// src/repositories/taskInstanceRepo.js
const db = require('../database/connection');

const listByChecklistInstance = async (checklist_instance_id) => {
  const res = await db.query(
    `SELECT ti.*, t.title AS task_title, t.description AS task_description
     FROM tbl_task_instance ti
     LEFT JOIN tbl_task t ON t.id = ti.task_id
     WHERE ti.checklist_instance_id = $1
     ORDER BY ti.created_at`,
    [checklist_instance_id]
  );
  return res.rows;
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_task_instance WHERE id = $1', [id]);
  return res.rows[0];
};

const complete = async (id, completed_by = null) => {
  const q = `
    UPDATE tbl_task_instance
    SET status = 'completed',
        completed_at = now(),
        assigned_user_id = COALESCE($2, assigned_user_id)
    WHERE id = $1
    RETURNING *;
  `;
  const res = await db.query(q, [id, completed_by]);
  return res.rows[0];
};

const update = async (id, patch) => {
  const keys = Object.keys(patch);
  if (!keys.length) return findById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);
  const q = `UPDATE tbl_task_instance SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

module.exports = { listByChecklistInstance, findById, complete, update };
