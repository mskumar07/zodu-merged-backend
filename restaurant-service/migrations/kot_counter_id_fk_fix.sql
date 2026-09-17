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
-- tbl_kot_counters was empty on every environment this was first tried on
-- locally, but UAT had a real, live tbl_menu_items.kot_counter_id value left
-- over from the old tbl_kot_counter table — with tbl_kot_counters freshly
-- created and still empty at this point in the migration order, that value
-- can't possibly match a real row, so adding the FK straight away fails.
-- There's no real counter to migrate it to (the old table it pointed at is
-- being dropped as dead weight right after this file), so the only safe
-- move is clearing it back to unassigned — same as a menu item that never
-- had a counter picked.
--
-- kot_counter.sql is no longer applied on fresh environments (see
-- apply-migrations.sh / kot_counter_drop_legacy.sql), so on those,
-- kot_counters_printers.sql's own `ADD COLUMN ... REFERENCES
-- tbl_kot_counters` already attaches a correct (auto-named) FK — checked by
-- target table + column here, not by a specific constraint name, so this
-- doesn't add a second, redundant FK alongside it.
--
-- Run this once against the restaurant-service database, after
-- kot_counters_printers.sql. Safe to re-run.

ALTER TABLE tbl_menu_items
    DROP CONSTRAINT IF EXISTS fk_menu_items_kot_counter;

UPDATE tbl_menu_items
SET kot_counter_id = NULL
WHERE kot_counter_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tbl_kot_counters WHERE id = tbl_menu_items.kot_counter_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'tbl_menu_items'::regclass
          AND c.confrelid = 'tbl_kot_counters'::regclass
          AND c.conkey = ARRAY[(
              SELECT attnum FROM pg_attribute
              WHERE attrelid = 'tbl_menu_items'::regclass AND attname = 'kot_counter_id'
          )]
    ) THEN
        ALTER TABLE tbl_menu_items
            ADD CONSTRAINT fk_menu_items_kot_counter_id FOREIGN KEY (kot_counter_id)
            REFERENCES tbl_kot_counters(id)
            ON DELETE SET NULL;
    END IF;
END
$$;
