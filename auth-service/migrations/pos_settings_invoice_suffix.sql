-- Adds an invoice suffix to tbl_pos_settings — trailing text on the invoice
-- ID (e.g. a fiscal year like "26-27"), alongside the existing invoice
-- numbering fields on tbl_invoice_settings (invoice_prefix, etc.).
--
-- invoice_suffix_enabled lets a branch save a suffix without applying it
-- yet (toggled off), matching the "saved but not applied" behaviour of
-- other POS numbering fields.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS invoice_suffix VARCHAR(20),
    ADD COLUMN IF NOT EXISTS invoice_suffix_enabled BOOLEAN NOT NULL DEFAULT FALSE;
