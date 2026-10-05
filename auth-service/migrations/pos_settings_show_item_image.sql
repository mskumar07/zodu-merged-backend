-- Adds show_item_image to tbl_pos_settings — whether the restaurant POS menu
-- cards show each item's photo. Defaults to true so every existing branch
-- keeps the photos it already sees until someone switches them off in POS
-- settings.
--
-- Saved through PUT /api/pos-settings/:zodu_id/:branch_id. See
-- business-repo.js (upsertPosSettings).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_pos_settings
    ADD COLUMN IF NOT EXISTS show_item_image BOOLEAN NOT NULL DEFAULT true;
