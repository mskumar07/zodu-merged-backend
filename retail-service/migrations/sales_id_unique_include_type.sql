-- Widens tbl_sales' sale_id uniqueness to include sale_type.
--
-- Now that Quotation/Proforma prefixes are independently settings-driven
-- (see pos_settings_type_prefixes.sql) rather than hard-coded distinct
-- values, a business can configure quotation_prefix/proforma_prefix the same
-- as invoice_prefix. Each sale type still has its own counter in
-- tbl_doc_id_seq, so two different sale types can land on the same
-- prefix+number and produce the identical sale_id text — previously a hard
-- constraint violation. Adding sale_type to the constraint allows that.
--
-- IMPORTANT: this ADDS sale_type to whatever the existing constraint's
-- columns are — it does NOT assume the old constraint was only
-- (sale_id, branch_id). Environments have drifted: local/UAT had
-- UNIQUE(sale_id, branch_id), but production already had
-- UNIQUE(sale_id, branch_id, zodu_id) — branch_id alone repeats across
-- tenants (e.g. seven different zodu_ids all have a "B1" that starts its own
-- numbering at INV-B1-001), so dropping zodu_id from the key would have
-- treated different tenants' sales as colliding. The new constraint below
-- keeps every column the databases in this codebase are known to have used
-- (sale_id, branch_id, zodu_id) and adds sale_type on top.
--
-- NOTE: with this, (sale_id, branch_id, zodu_id) without sale_type is no
-- longer guaranteed unique — code that looks up a sale by sale_id should
-- pass sale_type when it has it (see retail-repo.js getSaleById/deleteSale)
-- and otherwise falls back to the most recent match.
--
-- Run this once against the retail_service database.
-- Safe to re-run: guarded by existence checks.

-- Drop-and-recreate rather than add-if-missing: an earlier version of this
-- migration (already run against some databases before this fix) created
-- unique_sale_per_branch_type WITHOUT zodu_id. Checking existence by name
-- alone would skip fixing that wrong definition, so this always drops
-- whichever of the two constraint names is present and recreates the
-- 4-column version, on every run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_sale_per_branch'
  ) THEN
    ALTER TABLE tbl_sales DROP CONSTRAINT unique_sale_per_branch;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_sale_per_branch_type'
  ) THEN
    ALTER TABLE tbl_sales DROP CONSTRAINT unique_sale_per_branch_type;
  END IF;

  ALTER TABLE tbl_sales
    ADD CONSTRAINT unique_sale_per_branch_type UNIQUE (sale_id, branch_id, zodu_id, sale_type);
END $$;
