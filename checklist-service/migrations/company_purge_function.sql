-- Hard-deletes every row scoped to one zodu_id (ALL branches) in
-- checklist-service, as part of the "delete company" flow. Superset of
-- fn_purge_branch (see branch_purge_function.sql) — same tables and join
-- chain, just without the branch_id predicate.
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against checklist-service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_company(p_zodu_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_checklist_item_progress cip
    USING tbl_checklist_items cit, tbl_checklists c
    WHERE cip.item_id = cit.id
      AND cit.checklist_id = c.id
      AND c.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_item_progress'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_assignees ca
    USING tbl_checklists c
    WHERE ca.checklist_id = c.id
      AND c.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_assignees'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_attachments cat
    USING tbl_checklists c
    WHERE cat.checklist_id = c.id
      AND c.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_attachments'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_items cit
    USING tbl_checklists c
    WHERE cit.checklist_id = c.id
      AND c.zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_instances WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_instances'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklists WHERE zodu_id = p_zodu_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklists'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
