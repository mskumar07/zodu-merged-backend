-- Adds the leave tables (leave_management.sql) to the two purge functions, so deleting a branch or a
-- company also removes its leave types, leave requests and holidays.
--
-- Order matters: tbl_attendance first (its leave_request_id points at tbl_leave_requests), then the
-- leave requests (they point at employees and leave types), then leave types and holidays, then the
-- employees' own rows, exactly as before.
--
-- Same signatures as branch_purge_function.sql / company_purge_function.sql, so this replaces them.
-- Idempotent: CREATE OR REPLACE, and deleting already-gone rows deletes 0 rows.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_attendance WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_attendance'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_leave_requests WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_requests'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_leave_types WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_types'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_holidays WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_holidays'; rows_deleted := n; RETURN NEXT;

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

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_attendance WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_attendance'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_leave_requests WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_requests'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_leave_types WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_types'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_holidays WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_holidays'; rows_deleted := n; RETURN NEXT;

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
