-- Adds per-type ID prefixes to tbl_pos_settings, so Quotation and Proforma
-- numbering is fully settings-driven instead of hard-coded to "QUO" /
-- "<invoice_prefix>P" in retail-service's generateSaleId. Invoice itself
-- keeps using tbl_invoice_settings.invoice_prefix (already settings-driven).
--
-- Defaults match today's hard-coded values so nothing changes for any branch
-- until someone edits these via the POS settings screen.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS quotation_prefix VARCHAR(20) NOT NULL DEFAULT 'QUO',
    ADD COLUMN IF NOT EXISTS proforma_prefix  VARCHAR(20) NOT NULL DEFAULT 'PRO';
