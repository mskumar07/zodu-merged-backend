// db/taskNotesRepo.js
const db = require("../database/connection");

/**
 * Create note
 */
exports.create = async ({ task_id, note, created_by }) => {
    console.log("repo",task_id,note,created_by)
  const q = `
    INSERT INTO tbl_task_notes (task_id, note, created_by)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const res = await db.query(q, [task_id, note, created_by]);
  return res.rows[0];
};

/**
 * Update note
 */
exports.update = async ({ id, note }) => {
  const q = `
    UPDATE tbl_task_notes
    SET note = $2,
        updated_at = now()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await db.query(q, [id, note]);
  return res.rows[0];
};

/**
 * Delete note
 */
exports.remove = async (id) => {
  const q = `
    DELETE FROM tbl_task_notes
    WHERE id = $1
    RETURNING *;
  `;
  const res = await db.query(q, [id]);
  return res.rows[0];
};

/**
 * Get notes by task instance
 */
exports.getByTaskInstance = async (task_id) => {
  const q = `
    SELECT *
    FROM tbl_task_notes
    WHERE task_id = $1
    ORDER BY created_at ASC;
  `;
  const res = await db.query(q, [task_id]);
  return res.rows;
};
