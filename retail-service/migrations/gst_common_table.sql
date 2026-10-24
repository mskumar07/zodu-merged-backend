-- tbl_gst becomes ONE common rate list (id, gst_rate) shared by every company
-- and branch, instead of a per-branch copy (zodu_id, branch_id, gst_rate).
--
-- tbl_menu_items keeps pointing at a GST row by id. This script:
--   1. keeps one row per rate (the lowest id) and re-points every menu item that
--      used a duplicate row at it,
--   2. deletes the duplicate rows,
--   3. drops zodu_id / branch_id (and the indexes on them) from tbl_gst,
--   4. makes gst_rate unique and makes sure the default slabs (5, 18, 40) exist.
--
-- Bills are NOT touched: sale / purchase lines already copy gst_percentage, so
-- old reports keep the rate that applied when the bill was made.
--
-- Safe to re-run. Runs in one transaction, so a failure leaves nothing changed.
--
-- ORDER (scripts/apply-migrations.sh already applies them in this order):
--   a. this file
--   b. branch_default_units_24102026.sql, branch_purge_function_24102026.sql and
--      company_purge_function_24102026.sql - the replacement functions that no
--      longer touch tbl_gst columns (the purge functions would error without them)
--   c. deploy the new service code - the old code still filters tbl_gst on
--      branch_id and fails once the columns are gone, so do (a)-(c) together.

BEGIN;

CREATE TABLE IF NOT EXISTS tbl_gst (
    id         SERIAL PRIMARY KEY,
    gst_rate   NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE
    col text;
BEGIN
    -- Only needed while the per-branch columns still exist (keeps the script re-runnable).
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tbl_gst' AND column_name = 'branch_id'
    ) THEN
        -- old_id -> keep_id for every duplicate rate
        CREATE TEMP TABLE _gst_remap ON COMMIT DROP AS
        SELECT g.id AS old_id, k.keep_id
        FROM tbl_gst g
        JOIN (
            SELECT gst_rate::numeric AS rate, MIN(id) AS keep_id
            FROM tbl_gst
            GROUP BY gst_rate::numeric
        ) k ON k.rate = g.gst_rate::numeric
        WHERE g.id <> k.keep_id;

        -- tbl_menu_items stores the GST id in gst_type (retail style) and/or
        -- gst_tax (restaurant style); fix whichever exists.
        FOREACH col IN ARRAY ARRAY['gst_type', 'gst_tax'] LOOP
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'tbl_menu_items' AND column_name = col
            ) THEN
                EXECUTE format(
                    'UPDATE tbl_menu_items m
                        SET %1$I = r.keep_id
                       FROM _gst_remap r
                      WHERE m.%1$I::text = r.old_id::text',
                    col
                );
            END IF;
        END LOOP;

        DELETE FROM tbl_gst g USING _gst_remap r WHERE g.id = r.old_id;
    END IF;
END
$$;

-- Dropping the columns also drops every index that used them.
ALTER TABLE tbl_gst
    DROP COLUMN IF EXISTS zodu_id,
    DROP COLUMN IF EXISTS branch_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_gst_rate ON tbl_gst (gst_rate);

-- Default slabs (same set the old per-branch seed used). Add more later with a plain INSERT.
INSERT INTO tbl_gst (gst_rate)
SELECT v.gst_rate
FROM (VALUES (5), (18), (40)) AS v(gst_rate)
WHERE NOT EXISTS (SELECT 1 FROM tbl_gst g WHERE g.gst_rate::numeric = v.gst_rate);

COMMIT;

-- Check afterwards (should return one row per rate, no duplicates):
--   SELECT id, gst_rate FROM tbl_gst ORDER BY gst_rate::numeric;
-- And no menu item should point at a missing GST row (expect 0 rows):
--   SELECT m.item_uuid, m.gst_type FROM tbl_menu_items m
--   LEFT JOIN tbl_gst g ON g.id::text = m.gst_type::text
--   WHERE m.gst_type IS NOT NULL AND m.gst_type::text NOT IN ('0', '') AND g.id IS NULL;
-- (restaurant: use m.gst_tax instead of m.gst_type)
