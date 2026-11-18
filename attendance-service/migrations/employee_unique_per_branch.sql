-- Widens the employee uniqueness rule from (user_id, zodu_id) to
-- (user_id, zodu_id, branch_id), so the same admin/user can have a separate
-- tbl_employees row per branch of the same company — previously one user
-- could only ever have a single employee row per company, which blocked
-- seeding a default admin employee row when a NEW branch is added to an
-- EXISTING company (auth-service's AddBranch flow, POST /api/branch/add).
--
-- No existing data violates the new, wider constraint (a set that was
-- already unique on 2 columns stays unique when a 3rd is added), so this is
-- a safe drop+add with no cleanup needed.
--
-- Run this once against employee-service. Safe to re-run.

ALTER TABLE tbl_employees DROP CONSTRAINT IF EXISTS uq_employees_user_zodu;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_employees_user_zodu_branch'
  ) THEN
    ALTER TABLE tbl_employees ADD CONSTRAINT uq_employees_user_zodu_branch
      UNIQUE (user_id, zodu_id, branch_id);
  END IF;
END $$;
