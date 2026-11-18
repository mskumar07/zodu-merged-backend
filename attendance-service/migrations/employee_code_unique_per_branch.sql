-- Widens employee_code uniqueness from (employee_code, zodu_id) to
-- (employee_code, zodu_id, branch_id), matching generateEmployeeCode's move
-- to per-branch numbering (every branch's first employee is now EMP001,
-- not a company-wide running number) — without this, two branches of the
-- same company both generating EMP001 would collide on the old constraint.
--
-- No existing data violates the new, wider constraint (a set that was
-- already unique on 2 columns stays unique when a 3rd is added), so this is
-- a safe drop+add with no cleanup needed.
--
-- Run this once against employee-service. Safe to re-run.

ALTER TABLE tbl_employees DROP CONSTRAINT IF EXISTS tbl_employees_employee_code_zodu_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_employees_code_zodu_branch'
  ) THEN
    ALTER TABLE tbl_employees ADD CONSTRAINT uq_employees_code_zodu_branch
      UNIQUE (employee_code, zodu_id, branch_id);
  END IF;
END $$;
