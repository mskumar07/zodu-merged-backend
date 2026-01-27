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

const complete = async (task_id, user_id ) => {
  console.log(task_id,user_id)
  const q = `
    UPDATE tbl_task_instance ti
    SET
      status = 'completed',
      completed_at = now(),
      completed_by = $2
    FROM tbl_task t
    JOIN tbl_checklist_assignees ca
      ON ca.checklist_id = t.checklist_id
    WHERE ti.task_id = $1
      AND ti.task_id = t.id
      AND ca.user_id = $2
    RETURNING ti.*;
  `;

  const res = await db.query(q, [task_id, user_id]);

  if (res.rowCount === 0) {
    throw new Error('User not assigned to this checklist or invalid task');
  }

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

const createTx = async (checklist_instance_id, taskId) => {
  await db.query(
    `
    INSERT INTO tbl_task_instance
      (checklist_instance_id, task_id)
    VALUES ($1,$2)
    `,
    [
      checklist_instance_id,
      taskId,
      
    ]
  );
};

const removeByTaskId = async (task_id) => {
  console.log("fromtaskinstancerepo",task_id)
  await db.query(
    `
    DELETE FROM tbl_task_instance
    WHERE task_id = $1
    `,
    [task_id]
  );
};

const exists = async (checklistInstanceId, taskId) => {
  const q = `
    SELECT 1 FROM tbl_task_instance
    WHERE checklist_instance_id = $1 AND task_id = $2
    LIMIT 1
  `;
  const res = await db.query(q, [checklistInstanceId, taskId]);
  return res.rowCount > 0;
};



module.exports = { listByChecklistInstance, findById, complete, update, createTx, removeByTaskId ,exists};
