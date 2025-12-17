// src/repositories/checklistScheduleRepo.js
const db = require('../database/connection');

const create = async ({ checklist_id, timezone='UTC', due_at=null, recurrence_rrule=null, start_date=null, end_date=null, reminder_offsets=[] }) => {
  const q = `
    INSERT INTO tbl_checklist_schedule (checklist_id, timezone, due_at, recurrence_rrule, start_date, end_date, reminder_offsets)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *;
  `;
  const res = await db.query(q, [checklist_id, timezone, due_at, recurrence_rrule, start_date, end_date, reminder_offsets]);
  return res.rows[0];
};

const findByChecklistId = async (checklist_id) => {
  const res = await db.query('SELECT * FROM tbl_checklist_schedule WHERE checklist_id = $1', [checklist_id]);
  return res.rows;
};

const update = async (id, patch) => {
  console.log(id,patch)
  const keys = Object.keys(patch);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i+1}`);
  const vals = keys.map(k => patch[k]);
  vals.push(id);
  const q = `UPDATE tbl_checklist_schedule SET ${sets.join(', ')} WHERE id = $${keys.length+1} RETURNING *`;
  const res = await db.query(q, vals);
  return res.rows[0];
};

const remove = async (id) => {
  await db.query('DELETE FROM tbl_checklist_schedule WHERE id = $1', [id]);
  return true;
};

module.exports = { create, findByChecklistId, update, remove };
