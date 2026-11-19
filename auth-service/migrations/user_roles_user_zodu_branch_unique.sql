-- One role row per user per company branch. role-repo's assignEmployeeRole and
-- setUserRole upsert with ON CONFLICT (user_id, zodu_id, branch_id); without this
-- constraint Postgres refuses the insert ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification") and "Save & Set User" fails.
-- UAT and local already have it (added by hand); prod did not.
-- Idempotent. Stops, changing nothing, if duplicates exist that would block it.
DO $$
DECLARE dups int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'tbl_user_roles'::regclass AND i.indisunique
       AND pg_get_indexdef(i.indexrelid) LIKE '%(user_id, zodu_id, branch_id)'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO dups FROM (
    SELECT 1 FROM tbl_user_roles
     WHERE branch_id IS NOT NULL
     GROUP BY user_id, zodu_id, branch_id HAVING count(*) > 1
  ) d;
  IF dups > 0 THEN
    RAISE EXCEPTION 'tbl_user_roles has % duplicate (user_id, zodu_id, branch_id) groups; resolve them first', dups;
  END IF;

  ALTER TABLE tbl_user_roles
    ADD CONSTRAINT tbl_user_roles_user_zodu_branch_key UNIQUE (user_id, zodu_id, branch_id);
END $$;
