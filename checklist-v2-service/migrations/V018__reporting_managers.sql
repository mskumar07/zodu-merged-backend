-- checklist-v2-service · checklists follow the reporting line
-- The company Admin sees and assigns everyone; anyone else who manages checklists works
-- with their own team: the employees whose reporting manager they are (and themselves).
-- The directory keeps each employee's reporting manager and code (from employee-service).
-- Re-runnable.

ALTER TABLE ckl.employee_directory ADD COLUMN IF NOT EXISTS reporting_manager_id uuid;
ALTER TABLE ckl.employee_directory ADD COLUMN IF NOT EXISTS employee_code varchar(50);
CREATE INDEX IF NOT EXISTS idx_directory_manager
  ON ckl.employee_directory (zodu_id, branch_id, reporting_manager_id) WHERE reporting_manager_id IS NOT NULL;

-- Rows synced before this have no manager yet: the next sync of every branch is a full one.
UPDATE ckl.directory_sync_state SET last_full_sync_at = NULL, cursor_updated_at = NULL
 WHERE NOT EXISTS (SELECT 1 FROM ckl.employee_directory d WHERE d.reporting_manager_id IS NOT NULL);
