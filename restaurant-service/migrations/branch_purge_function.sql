-- Hard-deletes every row scoped to one (zodu_id, branch_id) in
-- restaurant_service (this service's own separate DB — NOT the shared
-- retail_restaurant_service retail-service uses), as part of the
-- "delete branch" flow.
--
-- Order matters: child tables (no branch_id of their own, linked via a
-- parent's id/uuid) must be deleted BEFORE their parent. Verified via live
-- information_schema.columns query (2026-09-11):
--   tables WITH branch_id+zodu_id directly: tbl_category, tbl_customer,
--     tbl_doc_id_seq, tbl_expense, tbl_expense_menu_items,
--     tbl_expense_payment, tbl_gst, tbl_hold, tbl_inventory, tbl_kot_list,
--     tbl_menu_items, tbl_ordered_items, tbl_orders, tbl_payment, tbl_purchase,
--     tbl_purchase_payment, tbl_resturant_branch, tbl_stock_ledger,
--     tbl_tmp_ordered_items, tbl_tmp_orders, tbl_units, tbl_vendor
--   tbl_order_no_counter has branch_id ONLY, no zodu_id column at all
--     (verified live 2026-09-11) — purged by branch_id alone.
--   tbl_order_no_template is intentionally NOT purged — per product
--     decision, that table is not in use.
--   child tables WITHOUT branch_id (delete via parent's key first):
--     tbl_expense_items (expense_id -> tbl_expense)
--     tbl_purchase_items (purchase_id -> tbl_purchase)
--   tbl_hold_items DOES carry branch_id + zodu_id directly here (unlike
--   retail-service's tbl_hold_items) — confirmed live via DBeaver
--   (2026-09-11): columns are id, zodu_id, branch_id, hold_id, item_name,
--   item_id, item_unit, qty, price, variant_name, variant_id, created_at.
--   Its parent tbl_hold's key is hold_id (not hold_uuid — restaurant-repo.js
--   still references hold_uuid in some queries, a pre-existing mismatch
--   unrelated to this purge function). Deleted directly, no join needed.
--   tbl_kot_list / tbl_ordered_items / tbl_tmp_ordered_items DO carry
--     branch_id directly (confirmed), so they're deleted like any other
--     direct table, before tbl_orders/tbl_tmp_orders.
--   tbl_company_registration has zodu_id only, no branch_id — company-level,
--     not branch-level, so intentionally excluded from this purge.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against restaurant_service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    -- Children of tables without their own branch_id
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

    -- Direct branch-scoped tables, order/kot children before their parents
    DELETE FROM tbl_hold_items WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_hold_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_kot_list WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_kot_list'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_ordered_items WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_ordered_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_payment WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_payment'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_orders WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_orders'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_tmp_ordered_items WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_tmp_ordered_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_tmp_orders WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_tmp_orders'; rows_deleted := n; RETURN NEXT;

    -- No zodu_id column on this table — branch_id only (verified live
    -- 2026-09-11). tbl_order_no_template is intentionally NOT purged here —
    -- per product decision, that table is not in use.
    DELETE FROM tbl_order_no_counter WHERE branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_order_no_counter'; rows_deleted := n; RETURN NEXT;

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

    DELETE FROM tbl_doc_id_seq WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_doc_id_seq'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_resturant_branch WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_resturant_branch'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
