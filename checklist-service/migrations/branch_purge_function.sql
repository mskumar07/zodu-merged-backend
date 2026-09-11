-- Hard-deletes every row scoped to one (zodu_id, branch_id) in
-- checklist-service, as part of the "delete branch" flow.
--
-- Verified via live information_schema.columns query (2026-09-11), including
-- a follow-up correction after the first version had wrong join columns:
--   tbl_checklists            — PK is `id` (NOT checklist_id). Has
--                                branch_id + zodu_id directly.
--   tbl_checklist_instances   — PK is `id`; FK `checklist_id` -> tbl_checklists.id.
--                                Has branch_id + zodu_id directly. Nothing
--                                else references tbl_checklist_instances —
--                                no instance_id column exists anywhere else
--                                in this schema.
--   tbl_checklist_items       — PK is `id`; FK `checklist_id` -> tbl_checklists.id.
--                                No branch_id of its own.
--   tbl_checklist_assignees   — FK `checklist_id` -> tbl_checklists.id. No branch_id.
--   tbl_checklist_attachments — FK `checklist_id` -> tbl_checklists.id. No branch_id.
--   tbl_checklist_item_progress — FK `item_id` -> tbl_checklist_items.id.
--                                No instance_id column, no branch_id of its own.
--
-- Deletion order, deepest child first:
--   tbl_checklist_item_progress (item_id -> tbl_checklist_items.id -> checklist_id -> tbl_checklists.id)
--   tbl_checklist_assignees, tbl_checklist_attachments, tbl_checklist_items (checklist_id -> tbl_checklists.id)
--   tbl_checklist_instances (branch_id direct)
--   tbl_checklists (branch_id direct)
--
-- Idempotent / retry-safe: deleting already-gone rows just deletes 0 rows.
-- Run this once against checklist-service. Safe to re-run: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_purge_branch(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS TABLE(table_name TEXT, rows_deleted BIGINT) AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM tbl_checklist_item_progress cip
    USING tbl_checklist_items cit, tbl_checklists c
    WHERE cip.item_id = cit.id
      AND cit.checklist_id = c.id
      AND c.zodu_id = p_zodu_id AND c.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_item_progress'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_assignees ca
    USING tbl_checklists c
    WHERE ca.checklist_id = c.id
      AND c.zodu_id = p_zodu_id AND c.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_assignees'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_attachments cat
    USING tbl_checklists c
    WHERE cat.checklist_id = c.id
      AND c.zodu_id = p_zodu_id AND c.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_attachments'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_items cit
    USING tbl_checklists c
    WHERE cit.checklist_id = c.id
      AND c.zodu_id = p_zodu_id AND c.branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_items'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklist_instances WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklist_instances'; rows_deleted := n; RETURN NEXT;

    DELETE FROM tbl_checklists WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    table_name := 'tbl_checklists'; rows_deleted := n; RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;
