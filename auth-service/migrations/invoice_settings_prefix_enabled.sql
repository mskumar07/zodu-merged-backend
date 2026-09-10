-- Adds an on/off toggle for tbl_invoice_settings.invoice_prefix — lets a
-- branch save a prefix without applying it, matching the "Invoice Prefix"
-- toggle on the Invoice Numbering screen.
--
-- Defaults to TRUE so every existing branch keeps showing its prefix exactly
-- as it does today (generateSaleId / generatePublicOrderNo already always
-- apply invoice_prefix when present) until a branch explicitly turns it off.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS invoice_prefix_enabled BOOLEAN NOT NULL DEFAULT FALSE;
