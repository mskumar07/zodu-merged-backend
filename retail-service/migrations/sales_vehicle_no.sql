-- Adds vehicle_no to tbl_sales — the delivery vehicle's registration number,
-- printed on the "Transport Copy" of the invoice (see
-- auth-service/migrations/invoice_settings_copy_types.sql).
--
-- Nullable, no default: most sales are counter sales with no vehicle involved,
-- and existing rows have nothing to backfill.
--
-- Run this once against the retail_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_sales
    ADD COLUMN IF NOT EXISTS vehicle_no VARCHAR(20);
