-- Drops tbl_kot_counter (singular) — the original KOT-counter table from
-- kot_counter.sql, superseded a day later by tbl_kot_counters (plural) in
-- kot_counters_printers.sql, which is what the actual feature (kot-repo.js,
-- kot-controller.js) reads and writes. kot_counter_id_fk_fix.sql already
-- repointed tbl_menu_items.kot_counter_id away from this table, so nothing
-- references it any more; it has stayed empty everywhere it was applied.
--
-- kot_counter.sql itself is left in the repo as a historical record but is
-- no longer invoked by apply-migrations.sh, so this only ever needs to run
-- once per database that had already applied it (today, that's local only —
-- UAT/prod never ran it). Safe to re-run: DROP ... IF EXISTS throughout.
--
-- Run this once against the restaurant-service database, after
-- kot_counter_id_fk_fix.sql.

DROP TABLE IF EXISTS tbl_kot_counter CASCADE;
DROP FUNCTION IF EXISTS fn_set_kot_counter_code();
