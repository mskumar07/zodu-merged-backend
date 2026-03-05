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
