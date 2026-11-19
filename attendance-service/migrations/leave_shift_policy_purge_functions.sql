-- Branch / company purge functions for the attendance database: deleting a branch or a company also removes
-- its leave types, leave policies, leave requests, holidays and shift templates (leave_management.sql,
-- leave_policies.sql, shift_templates.sql).
--
-- Order matters: tbl_attendance first (its leave_request_id points at tbl_leave_requests), then the
-- leave requests (they point at employees and leave types), then leave types, leave policies, holidays and shift templates,
-- then the employees' own rows, exactly as before.
--
-- Was leave_purge_functions.sql (leave tables only), then leave_shift_purge_functions.sql. Renamed each time a table was
-- added (shift templates, then leave policies), because
-- scripts/apply-migrations.sh skips a file it has already recorded under its old name; the new name makes it run
-- once more on every environment. Same signatures as branch_purge_function.sql / company_purge_function.sql,
-- so this replaces them. Must run after shift_templates.sql and leave_policies.sql.
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

    DELETE FROM tbl_leave_policies WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_policies'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_holidays WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_holidays'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_templates WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_templates'; rows_deleted := n; RETURN NEXT;

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

    DELETE FROM tbl_leave_policies WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_leave_policies'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_holidays WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_holidays'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_templates WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_templates'; rows_deleted := n; RETURN NEXT;

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
