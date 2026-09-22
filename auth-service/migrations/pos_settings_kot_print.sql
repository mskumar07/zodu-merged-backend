-- Adds kot_print_enabled to tbl_pos_settings — whether the restaurant POS
-- prints a KOT (kitchen order ticket) together with the bill, on the same
-- printer connected to the billing PC. Defaults to false so no existing
-- branch changes until someone switches it on in POS settings.
--
-- Saved through PUT /api/pos-settings/:zodu_id/:branch_id, alongside
-- pos_screen_type. See business-repo.js (upsertPosSettings).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS kot_print_enabled BOOLEAN NOT NULL DEFAULT false;
