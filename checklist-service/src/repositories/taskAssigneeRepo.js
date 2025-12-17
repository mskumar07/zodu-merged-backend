const db = require('../database/connection');

const assignTx = async ({ checklist_id, user_id }) => {
  await db.query(
    `
    INSERT INTO tbl_checklist_assignees (checklist_id, user_id)
    VALUES ($1,$2)
    ON CONFLICT DO NOTHING
    `,
    [checklist_id, user_id]
  );
};

const listAssignees = async ({ zodu_id, branch_id }) => {
  const res = await db.query(
    `
    SELECT
      u.id,
      u.name,
      u.user_id
    FROM tbl_users u
    WHERE u.zodu_id = $1
      AND u.branch_id = $2
    ORDER BY u.name
    `,
    [zodu_id, branch_id]
  );

  return res.rows;
};


const removeByChecklist = async (checklist_id) => {
  await db.query(
    `
    DELETE FROM tbl_checklist_assignees
    WHERE checklist_id = $1
    `,
    [checklist_id]
  );
};


module.exports = {assignTx,removeByChecklist,listAssignees};