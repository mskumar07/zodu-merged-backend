-- Hard-deletes every row scoped to one (zodu_id, branch_id) in this database,
-- as part of the "delete branch" flow. auth-service's scope covers
-- tbl_pos_settings, tbl_invoice_settings, tbl_roles, tbl_user_roles (branch-
-- scoped rows only), then tbl_branch itself. tbl_access_control still
-- carries branch_id too but is deliberately excluded per product decision —
-- do not add it here without re-confirming that decision.
--
-- tbl_users/tbl_user_sessions are intentionally NOT touched here (product
-- decision, 2026-09-17): a user is a company-level concept via
-- tbl_user_companies, not a branch-level one. Deleting tbl_users directly
-- from branch-scoped tbl_user_roles rows was tried and reverted — it threw
-- a foreign key violation on tbl_user_companies_user_id_fkey whenever that
-- user still had a tbl_user_companies row (this company or any other), since
-- tbl_user_companies was never cleared first. Only fn_purge_company deletes
-- tbl_users, and only for a user left with zero tbl_user_companies rows
-- anywhere after that company's mapping is removed — see
-- company_purge_function.sql.
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

    DELETE FROM tbl_user_roles WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_branch WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_branch'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
