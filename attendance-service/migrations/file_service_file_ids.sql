-- employee-service — documents uploaded through file-service keep only a
-- file_id; file_url stays for documents from before (old /employee/file/ URLs)
-- until the Phase 3 data migration. Idempotent.

ALTER TABLE tbl_employee_documents
    ADD COLUMN IF NOT EXISTS file_id UUID;

ALTER TABLE tbl_employee_documents
    ALTER COLUMN file_url DROP NOT NULL;
