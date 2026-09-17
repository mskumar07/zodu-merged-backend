-- Fixes a FK left pointing at the wrong table by two migrations that both
-- claim tbl_menu_items.kot_counter_id: the older kot_counter.sql created a
-- singular tbl_kot_counter table and FK'd this column to it; the newer
-- kot_counters_printers.sql (the one the actual KOT printer feature —
-- kot-repo.js's assignCounterItems/updateItemRouting — reads and writes)
-- introduced the real tbl_kot_counters (plural) table instead, but its
-- `ADD COLUMN IF NOT EXISTS kot_counter_id ... REFERENCES tbl_kot_counters`
-- was a no-op wherever kot_counter.sql had already run first, since the
-- column already existed — so the FK never moved. Left as-is, every counter
-- assignment through the new feature fails with a FK violation, because the
-- ids it writes live in tbl_kot_counters, not tbl_kot_counter.
--
-- Both tables are empty in every environment this has been applied to so
-- far, so there is no data to migrate — just repoint the constraint.
--
-- Run this once against the restaurant-service database, after
-- kot_counters_printers.sql. Safe to re-run.

ALTER TABLE tbl_menu_items
    DROP CONSTRAINT IF EXISTS fk_menu_items_kot_counter;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_menu_items_kot_counter_id'
    ) THEN
        ALTER TABLE tbl_menu_items
            ADD CONSTRAINT fk_menu_items_kot_counter_id FOREIGN KEY (kot_counter_id)
            REFERENCES tbl_kot_counters(id)
            ON DELETE SET NULL;
    END IF;
END
$$;
