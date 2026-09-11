-- Hard-deletes every row scoped to one (zodu_id, branch_id) in
-- employee-service, as part of the "delete branch" flow.
--
-- Verified via live information_schema.columns query (2026-09-11): only 4
-- tables in this database, all with branch_id + zodu_id directly, no
-- separate branch-mapping table — an employee belongs to exactly one
-- branch. tbl_attendance / tbl_employee_documents /
-- tbl_employee_emergency_contacts all reference employee_id but also carry
-- branch_id themselves, so they can be deleted directly without a join.
--
-- Children (attendance/documents/emergency contacts) deleted before
-- tbl_employees itself so nothing is left pointing at a removed employee.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against employee-service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_attendance WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_attendance'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employee_documents WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employee_documents'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employee_emergency_contacts WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employee_emergency_contacts'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_employees WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_employees'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
