const conn = require("../database/connection");

exports.getBranches = async (zodu_id, branch_id = null) => {
  const params = [zodu_id];
  let query = `
    SELECT *
    FROM tbl_resturant_branch
    WHERE zodu_id = $1
  `;

  if (branch_id) {
    params.push(branch_id);
    query += ` AND branch_id = $2`;
  }

  query += ` ORDER BY branch_id ASC`;

  const result = await conn.query(query, params);
  return result.rows;
};

exports.getBranchByIds = async (zodu_id, branch_id) => {
  const result = await conn.query(
    `SELECT *
     FROM tbl_resturant_branch
     WHERE zodu_id = $1 AND branch_id = $2
     LIMIT 1`,
    [zodu_id, branch_id]
  );

  return result.rows[0] || null;
};

exports.updateBranch = async (zodu_id, branch_id, fields) => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  const values = Object.values(fields);
  const setQuery = [
    ...keys.map((key, index) => `${key} = $${index + 1}`),
    `updated_at = now()`,
  ].join(', ');

  const result = await conn.query(
    `UPDATE tbl_resturant_branch
     SET ${setQuery}
     WHERE zodu_id = $${keys.length + 1}
       AND branch_id = $${keys.length + 2}
     RETURNING *`,
    [...values, zodu_id, branch_id]
  );

  return result.rows[0] || null;
};
