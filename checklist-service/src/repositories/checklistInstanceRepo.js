// src/repositories/checklistInstanceRepo.js
const db = require('../database/connection');
const { get } = require('../routes');

const create = async (data) => {
  const res = await db.query(
    `
    INSERT INTO tbl_checklist_instance
      (checklist_id, scheduled_for, status)
    VALUES ($1,$2,$3)
    RETURNING *
    `,
    [data.checklist_id, data.scheduled_for, data.status]
  );
  return res.rows[0];
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_checklist_instance WHERE id = $1', [id]);
  return res.rows[0];
};

const listByChecklist = async (checklist_id, { limit = 50, offset = 0 } = {}) => {
  const res = await db.query(
    'SELECT * FROM tbl_checklist_instance WHERE checklist_id = $1 ORDER BY scheduled_for DESC LIMIT $2 OFFSET $3',
    [checklist_id, limit, offset]
  );
  return res.rows;
};

const updateStatus = async (id, status) => {
  const res = await db.query('UPDATE tbl_checklist_instance SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
  return res.rows[0];
};

const getLatestByChecklist = async (checklist_id) => {
  const res = await db.query(
    `
    SELECT *
    FROM tbl_checklist_instance
    WHERE checklist_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [checklist_id]
  );
  return res.rows[0] || null;
};


module.exports = { create, findById, listByChecklist, updateStatus,getLatestByChecklist };
