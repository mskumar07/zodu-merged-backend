-- Hard-deletes every row scoped to one (zodu_id, branch_id) in
-- payroll-service, as part of the "delete branch" flow.
--
-- Verified via live information_schema.columns query (2026-09-11): only one
-- table in this database, tbl_employee_salary, with branch_id + zodu_id
-- directly. Confirmed with the user this is a true hard delete, including
-- payroll/salary history — no retention exclusion requested.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against payroll-service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_employee_salary WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employee_salary'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
