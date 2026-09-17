-- Hard-deletes every row scoped to one zodu_id (ALL branches) in
-- retail_restaurant_service, as part of the "delete company" flow. Superset
-- of fn_purge_branch (see branch_purge_function.sql) — identical table set
-- and join chain, just without the branch_id predicate, so composite-key
-- sequence tables (tbl_doc_id_seq, tbl_sale_sequence) are cleared across
-- every branch of this company in one call.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against retail_restaurant_service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    -- Children first (matched via their parent's zodu_id rows)
    DELETE FROM tbl_sale_return_items sri
    USING tbl_sale_returns sr
    WHERE sri.return_uuid = sr.return_uuid
      AND sr.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_return_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sale_items si
    USING tbl_sales s
    WHERE si.sale_uuid = s.sale_uuid
      AND s.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_items'; rows_deleted := n; RETURN NEXT;

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

    DELETE FROM tbl_hold_items hi
    USING tbl_hold h
    WHERE hi.hold_uuid = h.hold_uuid
      AND h.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold_items'; rows_deleted := n; RETURN NEXT;

    -- Now the direct zodu_id-scoped tables, children before their own parents
    DELETE FROM tbl_sale_payment WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sale_returns WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_returns'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_sales WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sales'; rows_deleted := n; RETURN NEXT;

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

    DELETE FROM tbl_sale_sequence WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_sale_sequence'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_doc_id_seq WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_doc_id_seq'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_expense_menu_item_seq WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_expense_menu_item_seq'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
