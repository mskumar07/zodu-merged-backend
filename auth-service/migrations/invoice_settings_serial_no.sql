-- Adds the "Show Serial Number" print-layout toggle on tbl_invoice_settings —
-- whether line items are numbered (1, 2, 3, ...) on the printed invoice.
-- Defaults to TRUE so existing branches keep showing serial numbers, matching
-- today's invoice layout, until a branch explicitly turns it off.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_serial_no BOOLEAN NOT NULL DEFAULT TRUE;
