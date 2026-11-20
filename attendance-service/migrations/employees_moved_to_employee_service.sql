-- Employees (records, documents, emergency contacts, faces) are employee-service's now; attendance-service reads
-- them through employee-service's GET /internal/employees/roster and keeps no employee table of its own.
-- This migration lets the attendance database work without tbl_employees:
--   1. drops the foreign keys that point at tbl_employees (tbl_attendance.employee_id, tbl_leave_requests.employee_id):
--      an employee created in employee-service has no row here, so the keys would refuse its attendance and leave.
--   2. drops the trigger that seeded a branch's default leave types on its first employee (the service now seeds
--      them the first time the branch's leave types or balances are read).
--   3. replaces fn_purge_branch / fn_purge_company without the employee tables (employee-service purges those).
-- Idempotent. The tables themselves are left alone: drop_local_employee_tables.sql removes them, by hand, once
-- the new build is verified (apply-migrations.sh runs it right after).

DO $$
DECLARE c RECORD;
BEGIN
    IF to_regclass('public.tbl_employees') IS NOT NULL THEN
        FOR c IN
            SELECT conrelid::regclass AS tbl, conname
            FROM pg_constraint
            WHERE contype = 'f' AND confrelid = 'public.tbl_employees'::regclass
              AND conrelid IN (to_regclass('public.tbl_attendance'), to_regclass('public.tbl_leave_requests'))
        LOOP
            EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
        END LOOP;

        DROP TRIGGER IF EXISTS trg_employees_seed_leave_types ON tbl_employees;
    END IF;
END $$;

DROP FUNCTION IF EXISTS fn_employees_seed_leave_types();

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

    RETURN;
END;
$$ LANGUAGE plpgsql;
