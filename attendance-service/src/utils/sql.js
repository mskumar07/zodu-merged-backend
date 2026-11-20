// Small helpers for building queries.

/** A search box's text as an ILIKE pattern ("%text%", with %, _ and \ made literal); null when empty. */
const likeOf = (search) => {
  const text = search ? String(search).trim() : '';
  return text ? `%${text.replace(/[\\%_]/g, '\\$&')}%` : null;
};

/**
 * The branch's employees as a table named `tbl_employees`-style `emp`, built from the roster JSON that
 * employee-service sent (clients/employee-directory.js). `n` is the number of the query parameter holding
 * the JSON. Use it as the first CTE of a query: `WITH ${EMPLOYEES_CTE(9)}, other AS (...)`.
 */
const EMPLOYEES_CTE = (n, name = 'tbl_employees') => `${name} AS (
  SELECT * FROM jsonb_to_recordset($${n}::jsonb) AS r(
    employee_id uuid, employee_code text, user_id text, name text, status text,
    reporting_manager_id uuid, reporting_manager_name text, zodu_id text, branch_id text)
)`;

module.exports = { likeOf, EMPLOYEES_CTE };
