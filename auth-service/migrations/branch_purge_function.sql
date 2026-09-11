-- Hard-deletes every row scoped to one (zodu_id, branch_id) in this database,
-- as part of the "delete branch" flow. auth-service's scope is intentionally
-- narrow: only tbl_pos_settings, tbl_invoice_settings, tbl_roles, then
-- tbl_branch itself. tbl_access_control and tbl_user_roles ALSO carry
-- branch_id but are deliberately excluded per product decision — do not add
-- them here without re-confirming that decision.
--
-- Called from auth-service once every other service (retail, restaurant,
-- employee, payroll, checklist) has successfully purged its own data for
-- this branch — auth-service runs last since tbl_branch is the source of
-- truth other services validate against.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows,
-- no error. Safe to call twice if a retry is needed after a partial failure.
--
-- Run this once against the shared database. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_pos_settings WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_pos_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_invoice_settings WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_invoice_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_roles WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_branch WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_branch'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
