// src/repositories/checklistRepo.js
const db = require('../database/connection');

const create = async ({ zodu_id, branch_id, name, description, category_id, created_by }) => {
  const q = `
    INSERT INTO tbl_checklist (zodu_id, branch_id, name, description, category_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
  `;
  const res = await db.query(q, [zodu_id, branch_id, name, description, category_id, created_by]);
  return res.rows[0];
};

const findById = async (id) => {
  const res = await db.query('SELECT * FROM tbl_checklist WHERE id = $1', [id]);
  return res.rows[0];
};

const list = async ({ zodu_id, branch_id, limit = 50, offset = 0 } = {}) => {
  const q = `
    SELECT * FROM tbl_checklist
    WHERE ($1::text IS NULL OR zodu_id = $1)
      AND ($2::text IS NULL OR branch_id = $2)
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4;
  `;
  const res = await db.query(q, [zodu_id || null, branch_id || null, limit, offset]);
  return res.rows;
};

const update = async (id, patch) => {
  const keys = Object.keys(patch);
  if (!keys.length) return findById(id);

  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);

  const q = `UPDATE tbl_checklist SET ${sets.join(', ')} WHERE id = $${keys.length + 1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

const remove = async (id) => {
  await db.query('DELETE FROM tbl_checklist WHERE id = $1', [id]);
  return true;
};

module.exports = { create, findById, list, update, remove };
