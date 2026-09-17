-- Hard-deletes every row scoped to one zodu_id (ALL branches) in
-- restaurant_service, as part of the "delete company" flow. Superset of
-- fn_purge_branch (see branch_purge_function.sql) — same table set and join
-- chain, just without the branch_id predicate.
--
-- Additions over the branch-level purge:
--   tbl_qr_code has no zodu_id column, but tbl_menu_items.qr_code_id points
--     to it directly (FK fk_qr_code_id, ON DELETE SET NULL — confirmed live
--     2026-09-16), per product decision. Captured into an array BEFORE
--     tbl_menu_items is deleted, then purged after, so we only remove QR
--     rows that belonged to this company's own menu items.
--
-- Excluded, matching fn_purge_branch: tbl_order_no_template (not in use),
-- tbl_order_no_counter and tbl_resturant_branch (confirmed unused — no code
-- references either table anywhere in restaurant-service, 2026-09-16),
-- tbl_payment / tbl_payment_history (dropped from the schema).
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against restaurant_service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
    v_qr_code_ids INT[];
BEGIN
    -- Capture this company's menu-item QR codes before tbl_menu_items is deleted
    SELECT ARRAY_AGG(DISTINCT qr_code_id) INTO v_qr_code_ids
    FROM tbl_menu_items
    WHERE zodu_id = p_zodu_id AND qr_code_id IS NOT NULL;

    -- Children of tables without their own zodu_id
    DELETE FROM tbl_purchase_items pi
    USING tbl_purchase p
    WHERE pi.purchase_id = p.purchase_id
      AND p.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_items ei
    USING tbl_expense e
    WHERE ei.expense_id = e.expense_id
      AND e.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_items'; rows_deleted := n; RETURN NEXT;

    -- Direct zodu_id-scoped tables, order/kot children before their parents
    DELETE FROM tbl_hold_items WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_kot_list WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_kot_list'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_ordered_items WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_ordered_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_orders WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_orders'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_tmp_ordered_items WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_tmp_ordered_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_tmp_orders WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_tmp_orders'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_purchase_payment WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_purchase WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_payment WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_menu_items WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_menu_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_hold WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_stock_ledger WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_stock_ledger'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_inventory WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_inventory'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_menu_items WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_menu_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_kot_counter WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_kot_counter'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_category WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_category'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_customer WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_customer'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_vendor WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_vendor'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_units WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_units'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_gst WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_gst'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_doc_id_seq WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_doc_id_seq'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_menu_item_seq WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_menu_item_seq'; rows_deleted := n; RETURN NEXT;

    -- QR codes that belonged to this company's own menu items, captured
    -- above before tbl_menu_items was deleted.
    IF v_qr_code_ids IS NOT NULL THEN
        DELETE FROM tbl_qr_code WHERE id = ANY(v_qr_code_ids);
        GET DIAGNOSTICS n = ROW_COUNT;
    ELSE
        n := 0;
    END IF;
    table_name := 'tbl_qr_code'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
