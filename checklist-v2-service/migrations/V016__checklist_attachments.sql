-- checklist-v2-service · checklist attachments
-- The checklist's "images" are now attachments: photos, PDF, Word or Excel (same
-- table and routes). content_type says which, so apps show a picture or a file.
-- Existing rows are images. Re-runnable.

ALTER TABLE ckl.checklist_images ADD COLUMN IF NOT EXISTS content_type varchar(120);
UPDATE ckl.checklist_images SET content_type = 'image/webp' WHERE content_type IS NULL;
ALTER TABLE ckl.checklist_images ALTER COLUMN content_type SET NOT NULL;
ALTER TABLE ckl.checklist_images ALTER COLUMN content_type SET DEFAULT 'image/webp';
