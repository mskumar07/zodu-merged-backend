-- Hard-deletes every row scoped to one (zodu_id, branch_id) in
-- retail_restaurant_service, as part of the "delete branch" flow.
--
-- Order matters: child tables (no branch_id of their own, linked via a
-- parent's id/uuid) must be deleted BEFORE their parent, or the parent
-- DELETE either fails on an FK or leaves orphaned children. Verified via
-- live information_schema.columns query (2026-09-11):
--   tables WITH branch_id+zodu_id directly: tbl_category, tbl_customer,
--     tbl_doc_id_seq, tbl_expense, tbl_expense_menu_items,
--     tbl_expense_payment, tbl_gst, tbl_hold, tbl_inventory, tbl_menu_items,
--     tbl_purchase, tbl_purchase_payment, tbl_sale_payment, tbl_sale_returns,
--     tbl_sale_sequence, tbl_sales, tbl_stock_ledger, tbl_units, tbl_vendor
--   child tables WITHOUT branch_id (delete via parent's key first):
--     tbl_expense_items (expense_id -> tbl_expense)
--     tbl_hold_items (hold_uuid -> tbl_hold)
--     tbl_purchase_items (purchase_id -> tbl_purchase)
--     tbl_sale_items (sale_uuid/sale_id -> tbl_sales)
--     tbl_sale_return_items (return_uuid -> tbl_sale_returns)
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against retail_restaurant_service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    -- Children first (matched via their parent's zodu_id/branch_id rows)
    DELETE FROM tbl_sale_return_items sri
    USING tbl_sal e_returns sr
    WHERE sri.return_uuid = sr.return_uuid
      AND sr.zodu_id = p_zodu_id AND sr.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_return_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sale_items si
    USING tbl_sales s
    WHERE si.sale_uuid = s.sale_uuid
      AND s.zodu_id = p_zodu_id AND s.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_purchase_items pi
    USING tbl_purchase p
    WHERE pi.purchase_id = p.purchase_id
      AND p.zodu_id = p_zodu_id AND p.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_items ei
    USING tbl_expense e
    WHERE ei.expense_id = e.expense_id
      AND e.zodu_id = p_zodu_id AND e.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_hold_items hi
    USING tbl_hold h
    WHERE hi.hold_uuid = h.hold_uuid
      AND h.zodu_id = p_zodu_id AND h.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold_items'; rows_deleted := n; RETURN NEXT;

    -- Now the direct branch-scoped tables, children before their own parents
    DELETE FROM tbl_sale_payment WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sale_returns WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_returns'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sales WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sales'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_purchase_payment WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_purchase WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_purchase'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_payment WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_menu_items WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_menu_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_hold WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_stock_ledger WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_stock_ledger'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_inventory WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_inventory'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_menu_items WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_menu_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_category WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_category'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_customer WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_customer'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_vendor WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_vendor'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_units WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_units'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_gst WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_gst'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sale_sequence WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_sequence'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_doc_id_seq WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_doc_id_seq'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
