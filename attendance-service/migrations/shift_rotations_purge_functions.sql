-- fn_purge_branch / fn_purge_company with tbl_shift_rotations and tbl_shift_assignments added: a branch / company purge also removes its shift
-- rotations (their days go with them) and shift assignments, and does it BEFORE the shift templates, which both point at.
-- (tbl_shift_assignments: shift_assignments.sql.)
-- REPLACES the versions in employees_moved_to_employee_service.sql, so it must run after it (apply-migrations.sh keeps
-- it last), and after shift_rotations.sql and shift_assignments.sql.
-- Idempotent: CREATE OR REPLACE.

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

    -- Assignments and rotations before templates: both point at the templates.
    DELETE FROM tbl_shift_assignments WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_assignments'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_rotations WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_rotations'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_templates WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_templates'; rows_deleted := n; RETURN NEXT;

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

    -- Assignments and rotations before templates: both point at the templates.
    DELETE FROM tbl_shift_assignments WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_assignments'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_rotations WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_rotations'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_shift_templates WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_shift_templates'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
