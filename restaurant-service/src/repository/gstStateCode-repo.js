const conn = require("../database/connection");

const COLUMNS = `id, state_code, state_name, short_code, state_type, is_active`;

// 🔹 LIST state codes (optional search on code / name / short code)
exports.getStateCodes = async ({ search, include_inactive } = {}) => {
  const where = [];
  const values = [];

  if (include_inactive !== "true") {
    where.push("is_active = TRUE");
  }

  if (search) {
    values.push(`%${search}%`);
    where.push(
      `(state_code ILIKE $${values.length} OR state_name ILIKE $${values.length} OR short_code ILIKE $${values.length})`
    );
  }

  const { rows } = await conn.query(
    `SELECT ${COLUMNS}
     FROM tbl_gst_state_code
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY state_code`,
    values
  );
  return rows;
};

// 🔹 GET one by 2-digit state code
exports.getByStateCode = async (state_code) => {
  const { rows } = await conn.query(
    `SELECT ${COLUMNS} FROM tbl_gst_state_code WHERE state_code = $1`,
    [state_code]
  );
  return rows[0] || null;
};
