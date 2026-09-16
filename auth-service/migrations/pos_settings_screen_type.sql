-- Adds pos_screen_type to tbl_pos_settings — whether the restaurant POS
-- billing screen opens in Touch or Keyboard layout. Defaults to 'Touch'
-- since that is today's only behavior, so no existing branch changes
-- until someone edits this via the POS settings screen.
--
-- Saved through PUT /api/invoice-settings/:zodu_id/:branch_id (the frontend
-- saves this field alongside stock_check_enabled/customer_mandatory from the
-- same "Additional Settings" section) as well as PUT /api/pos-settings/...
-- directly — upsertInvoiceSettings forwards it to upsertPosSettings /
-- tbl_pos_settings underneath. See business-repo.js.
--
-- Valid values ('Touch' / 'Keyboard') are enforced by the Joi schema
-- (edit_pos_settings / edit_invoice_settings in auth-schema.js), not a DB
-- CHECK constraint.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS pos_screen_type VARCHAR(20) NOT NULL DEFAULT 'Touch';
