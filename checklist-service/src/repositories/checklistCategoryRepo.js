// src/repositories/checklistCategoryRepo.js
const db = require('../database/connection');

const create = async ({ name, zodu_id = null, branch_id = null }) => {
  const q = `INSERT INTO tbl_checklist_category (name, zodu_id, branch_id) VALUES ($1,$2,$3) RETURNING *`;
  const res = await db.query(q, [name, zodu_id, branch_id]);
  return res.rows[0];
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_checklist_category WHERE id = $1', [id]);
  return res.rows[0];
};

const list = async ({ zodu_id = null, branch_id = null } = {}) => {
  const q = `SELECT * FROM tbl_checklist_category WHERE ($1::text IS NULL OR zodu_id = $1) AND ($2::text IS NULL OR branch_id = $2) ORDER BY name`;
  const res = await db.query(q, [zodu_id, branch_id]);
  return res.rows;
};

const update = async (id, patch) => {
  const keys = Object.keys(patch);
  if (!keys.length) return findById(id);
  const sets = keys.map((k,i) => `${k} = $${i+1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);
  const q = `UPDATE tbl_checklist_category SET ${sets.join(', ')} WHERE id = $${keys.length+1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

const remove = async (id) => {
  await db.query('DELETE FROM tbl_checklist_category WHERE id = $1', [id]);
  return true;
};

module.exports = { create, findById, list, update, remove };
