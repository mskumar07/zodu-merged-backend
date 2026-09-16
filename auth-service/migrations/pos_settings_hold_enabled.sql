-- Shows/hides the Hold Order/Bill feature on the POS screen. Defaults TRUE
-- since hold orders are already a live, usable feature — defaulting FALSE
-- would silently hide an already-shipped feature for every existing branch.
ALTER TABLE tbl_pos_settings
  ADD COLUMN IF NOT EXISTS hold_enabled BOOLEAN NOT NULL DEFAULT TRUE;
