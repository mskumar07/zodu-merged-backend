-- Rounds out Quotation/Proforma numbering to match what Invoice already has:
-- an enable toggle for the prefix, plus their own suffix + suffix toggle
-- (mirroring invoice_prefix_enabled on tbl_invoice_settings and
-- invoice_suffix/invoice_suffix_enabled already on this table).
--
-- *_prefix_enabled defaults to TRUE — quotation_prefix/proforma_prefix are
-- brand new columns (pos_settings_type_prefixes.sql) that are always applied
-- today, so this preserves that until a branch explicitly turns one off.
-- Unlike invoice_prefix_enabled, there's no "match existing behavior" reason
-- to default this to FALSE.
--
-- *_suffix / *_suffix_enabled are storage only for now, same as
-- invoice_suffix/invoice_suffix_enabled — not yet applied to generated ids.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS quotation_prefix_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS proforma_prefix_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS quotation_suffix VARCHAR(20),
    ADD COLUMN IF NOT EXISTS quotation_suffix_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS proforma_suffix VARCHAR(20),
    ADD COLUMN IF NOT EXISTS proforma_suffix_enabled BOOLEAN NOT NULL DEFAULT FALSE;
