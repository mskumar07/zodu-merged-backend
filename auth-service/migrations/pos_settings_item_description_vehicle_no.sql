-- Shows/hides the per-line Item Description field and the Vehicle No field on
-- the POS screen. Both default TRUE: item descriptions were always shown, and
-- defaulting FALSE would silently hide an already-shipped field for every
-- existing branch.
ALTER TABLE tbl_pos_settings
  ADD COLUMN IF NOT EXISTS item_description_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS vehicle_no_enabled BOOLEAN NOT NULL DEFAULT TRUE;
