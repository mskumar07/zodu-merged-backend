-- checklist-v2-service syncs each branch's employees incrementally
-- (GET /internal/employees/directory?updated_since=…). Re-runnable.
CREATE INDEX IF NOT EXISTS idx_employees_zodu_branch_updated
    ON tbl_employees (zodu_id, branch_id, updated_at);
