-- tbl_checklist_attachments.file_url was NOT NULL, but removing the last file
-- of a checklist (DELETE /checklists/:id/attachments/:file_id) leaves
-- jsonb_agg() with no rows, which yields NULL and the UPDATE fails with
--   null value in column "file_url" violates not-null constraint
--
-- Run this once against the checklist service's database.
-- Safe to re-run: DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE tbl_checklist_attachments
    ALTER COLUMN file_url DROP NOT NULL;
