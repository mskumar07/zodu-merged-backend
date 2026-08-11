-- Adds auto-generated, per (zodu_id, branch_id) sequential item_id
-- to tbl_expense_menu_items, formatted as EXPITEM001, EXPITEM002, ...
--
-- Run this once against the shared database (restaurant_service / retail_service,
-- same physical schema per the DBeaver screenshot). Safe to re-run: uses
-- IF NOT EXISTS / CREATE OR REPLACE guards.

-- 1. Add the item_id column back (was previously dropped from this table)
ALTER TABLE tbl_expense_menu_items
    ADD COLUMN IF NOT EXISTS item_id VARCHAR(50);

-- 2. Counter table: one row per (zodu_id, branch_id), incremented atomically
CREATE TABLE IF NOT EXISTS tbl_expense_menu_item_seq (
    zodu_id     VARCHAR(50) NOT NULL,
    branch_id   VARCHAR(50) NOT NULL,
    last_seq    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (zodu_id, branch_id)
);

-- 3. Trigger function: on insert, atomically bump the counter for this
--    (zodu_id, branch_id) and stamp item_id = EXPITEM{seq:03d}
CREATE OR REPLACE FUNCTION fn_set_expense_menu_item_id()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INTEGER;
BEGIN
    IF NEW.item_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO tbl_expense_menu_item_seq (zodu_id, branch_id, last_seq)
    VALUES (NEW.zodu_id, NEW.branch_id, 1)
    ON CONFLICT (zodu_id, branch_id)
    DO UPDATE SET last_seq = tbl_expense_menu_item_seq.last_seq + 1
    RETURNING last_seq INTO next_seq;

    NEW.item_id := 'EXPITEM' || LPAD(next_seq::text, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_expense_menu_item_id ON tbl_expense_menu_items;

CREATE TRIGGER trg_set_expense_menu_item_id
    BEFORE INSERT ON tbl_expense_menu_items
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_expense_menu_item_id();

-- 4. Backfill item_id for any existing rows, oldest first, per branch
WITH ordered AS (
    SELECT item_uuid, zodu_id, branch_id,
           ROW_NUMBER() OVER (PARTITION BY zodu_id, branch_id ORDER BY created_at, item_uuid) AS rn
    FROM tbl_expense_menu_items
    WHERE item_id IS NULL
)
UPDATE tbl_expense_menu_items t
SET item_id = 'EXPITEM' || LPAD(o.rn::text, 3, '0')
FROM ordered o
WHERE t.item_uuid = o.item_uuid;

-- 5. Seed the counter table from the backfilled max per branch, so the
--    trigger continues the sequence correctly for future inserts
INSERT INTO tbl_expense_menu_item_seq (zodu_id, branch_id, last_seq)
SELECT zodu_id, branch_id, MAX(SUBSTRING(item_id FROM 8)::int)
FROM tbl_expense_menu_items
WHERE item_id LIKE 'EXPITEM%'
GROUP BY zodu_id, branch_id
ON CONFLICT (zodu_id, branch_id)
DO UPDATE SET last_seq = GREATEST(tbl_expense_menu_item_seq.last_seq, EXCLUDED.last_seq);
