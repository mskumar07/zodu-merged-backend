// src/repositories/taskRepo.js
const db = require('../database/connection');

const create = async ({ checklist_id, title, description, reference_image_url = null, voice_url = null }) => {
  const q = `
    INSERT INTO tbl_task (checklist_id, title, description, reference_image_url, voice_url)
    VALUES ($1,$2,$3,$4,$5) RETURNING *;
  `;
  const res = await db.query(q, [checklist_id, title, description, reference_image_url, voice_url]);
  return res.rows[0];
};

const listByChecklist = async (checklist_id) => {
  const res = await db.query('SELECT * FROM tbl_task WHERE checklist_id = $1 ORDER BY created_at', [checklist_id]);
  return res.rows;
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_task WHERE id = $1', [id]);
  return res.rows[0];
};

const update = async (id, patch) => {
  const keys = Object.keys(patch);
  if (!keys.length) return findById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);
  const q = `UPDATE tbl_task SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

const remove = async (id) => {
  await db.query('DELETE FROM tbl_task WHERE id = $1', [id]);
  return true;
};

module.exports = { create, listByChecklist, findById, update, remove };
