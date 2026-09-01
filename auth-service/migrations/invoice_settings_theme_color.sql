-- Adds the invoice theme colour picked on the "Invoice settings" screen.
--
-- Stored as the '#RRGGBB' hex string the colour picker produces, so it goes
-- straight into the invoice template's CSS with no conversion either way.
-- CHECK keeps malformed values ('red', 'rgb(0,0,0)', '#FFF') out of the column
-- even if a write ever bypasses the Joi layer; the app normalises to uppercase.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS invoice_theme_color VARCHAR(225) NOT NULL DEFAULT '#C62828';

ALTER TABLE tbl_invoice_settings
    DROP CONSTRAINT IF EXISTS chk_invoice_settings_theme_color;

ALTER TABLE tbl_invoice_settings
    ADD CONSTRAINT chk_invoice_settings_theme_color
    CHECK (invoice_theme_color ~ '^#[0-9A-Fa-f]{6}$');
