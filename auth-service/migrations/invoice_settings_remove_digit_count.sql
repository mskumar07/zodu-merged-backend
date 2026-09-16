-- Drops tbl_invoice_settings.invoice_digit_count — it was already dead:
-- generateSaleId/generatePublicOrderNo hard-code digit padding to 3 and never
-- read this column (see the comment they carried: "digit_count/start_number
-- are fixed — the Settings screen no longer exposes them"). invoice_start_number
-- stays, it's intentionally kept as a "coming soon" field for future use.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses DROP COLUMN IF EXISTS.

ALTER TABLE tbl_invoice_settings
    DROP COLUMN IF EXISTS invoice_digit_count;
