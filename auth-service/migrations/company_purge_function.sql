-- Hard-deletes every row scoped to one zodu_id in retail_auth_service, as
-- part of the "delete company" flow. Unlike fn_purge_branch (which
-- deliberately excludes tbl_access_control/tbl_user_roles — see
-- branch_purge_function.sql), this is a full company teardown: nothing
-- about this zodu_id should survive, so those two ARE included here.
--
-- tbl_access_control has ON DELETE CASCADE from tbl_roles.role_id, so it's
-- cleaned up automatically once tbl_roles rows for this zodu_id are deleted
-- (still deleted explicitly first for a clear, auditable row count).
--
-- Orphaned-user cleanup (product decision): a user who belongs to NO OTHER
-- company after this one's tbl_user_companies rows are removed gets fully
-- deleted (tbl_users), not just unlinked. tbl_user_sessions cascades from
-- tbl_users ON DELETE CASCADE, so it needs no explicit DELETE here.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against retail_auth_service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
    v_affected_users UUID[];
BEGIN
    -- Users who have access to this company, captured before their
    -- tbl_user_companies mapping row is removed below.
    SELECT ARRAY_AGG(DISTINCT user_id) INTO v_affected_users
    FROM tbl_user_companies
    WHERE zodu_id = p_zodu_id;

    DELETE FROM tbl_access_control WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_access_control'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_user_roles WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_roles WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_roles'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_pos_settings WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_pos_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_invoice_settings WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_invoice_settings'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_branch WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_branch'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_user_companies WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_user_companies'; rows_deleted := n; RETURN NEXT;

    -- Of the users who had access to this company, fully delete any that
    -- now have zero remaining companies (tbl_user_sessions cascades).
    IF v_affected_users IS NOT NULL THEN
        DELETE FROM tbl_users u
        WHERE u.user_id = ANY(v_affected_users)
          AND NOT EXISTS (
            SELECT 1 FROM tbl_user_companies uc WHERE uc.user_id = u.user_id
          );
        GET DIAGNOSTICS n = ROW_COUNT;
    ELSE
        n := 0;
    END IF;
    table_name := 'tbl_users'; rows_deleted := n; RETURN NEXT;

    -- Root company record first — tbl_business.address_id/bank_details_id
    -- are forward FKs to tbl_address/tbl_bank_details (no ON DELETE CASCADE),
    -- so tbl_business must be gone before those two are deleted below, or
    -- Postgres blocks it with fk_company_bank / fk_company_address.
    -- tbl_branch (deleted above) carries the same two FKs and is already
    -- gone by this point.
    DELETE FROM tbl_business WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_business'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_bank_details WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_bank_details'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_address WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_address'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
