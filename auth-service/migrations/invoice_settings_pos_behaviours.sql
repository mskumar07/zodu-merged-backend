-- Adds the two "Additional Settings" toggles on the POS settings tab:
-- Stock Check (warn/block adding an item past its recorded stock) and
-- Customer Mandatory (require a selected customer to complete a sale).
-- Both default to FALSE so existing branches keep today's POS behaviour
-- until a branch explicitly opts in.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS stock_check_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS customer_mandatory   BOOLEAN NOT NULL DEFAULT FALSE;
