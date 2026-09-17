-- Hard-deletes every row scoped to one zodu_id (ALL branches) in
-- employee-service, as part of the "delete company" flow. Superset of
-- fn_purge_branch (see branch_purge_function.sql) — same 4 tables, just
-- without the branch_id predicate, so a single call clears every branch at once.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against employee-service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_attendance WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_attendance'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employee_documents WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employee_documents'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employee_emergency_contacts WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employee_emergency_contacts'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employees WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employees'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
