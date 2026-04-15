DROP INDEX IF EXISTS tbl_resturant_branch_branch_id_key;

ALTER TABLE tbl_resturant_branch
  DROP CONSTRAINT IF EXISTS tbl_resturant_branch_branch_id_key;

ALTER TABLE tbl_resturant_branch
  ADD CONSTRAINT uq_branch_zodu UNIQUE (branch_id, zodu_id);
