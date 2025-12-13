// src/repositories/notificationRepo.js
const db = require('../database/connection');

const create = async ({ user_id = null, checklist_instance_id = null, channel = 'inapp', payload = {} }) => {
  const q = `
    INSERT INTO tbl_notification (user_id, checklist_instance_id, channel, payload, status)
    VALUES ($1,$2,$3,$4,'queued') RETURNING *;
  `;
  const res = await db.query(q, [user_id, checklist_instance_id, channel, payload]);
  return res.rows[0];
};

const listByInstance = async (checklist_instance_id) => {
  const res = await db.query('SELECT * FROM tbl_notification WHERE checklist_instance_id = $1 ORDER BY created_at DESC', [checklist_instance_id]);
  return res.rows;
};

module.exports = { create, listByInstance };
