-- Adds the "Show Shipping Address" print-layout toggle on tbl_invoice_settings.
-- Defaults to FALSE so existing branches keep today's invoice layout (no
-- shipping address block) until a branch explicitly opts in.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_shipping_address BOOLEAN NOT NULL DEFAULT FALSE;
