-- KOT (Kitchen Order Ticket) printer counters/stations, e.g. "Main Kitchen", "Food", "Juice".
--
-- Each menu item routes to exactly one counter (a juice item prints to the juice
-- counter, a food item prints to the food counter). That is a plain many-to-one
-- relationship, so it is modeled as a single nullable FK column on tbl_menu_items
-- rather than a separate junction table — see kot_counter_id below. Reassigning an
-- item to a different counter is then a single UPDATE that overwrites the old value.
--
-- counter_code (KOT1, KOT2, ...) is stamped by a BEFORE INSERT trigger using the
-- shared tbl_doc_id_seq table (doc_type 'KOT', same table PUR/EXP/ORD ids already
-- use, scoped per zodu_id+branch_id) — same pattern as fn_set_purchase_id /
-- fn_set_expense_id in purchase_expense_id_sequence.sql. The app never sets
-- counter_code itself.
--
-- Run this once against the service's database.
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE
-- throughout.

CREATE TABLE IF NOT EXISTS tbl_kot_counter (
    id SERIAL PRIMARY KEY,
    zodu_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    counter_name VARCHAR(100) NOT NULL,
    counter_code VARCHAR(20),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_kot_counter_branch_name UNIQUE (zodu_id, branch_id, counter_name)
);

CREATE INDEX IF NOT EXISTS idx_kot_counter_branch
    ON tbl_kot_counter (zodu_id, branch_id)
    WHERE active = TRUE;

-- Stamp counter_code = 'KOT<seq>' on insert, atomically incremented per
-- (zodu_id, branch_id) via tbl_doc_id_seq. Assumes tbl_doc_id_seq already
-- exists (created by purchase_expense_id_sequence.sql).
CREATE OR REPLACE FUNCTION fn_set_kot_counter_code()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INTEGER;
BEGIN
    IF NEW.counter_code IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
    VALUES (NEW.zodu_id, NEW.branch_id, 'KOT', 1)
    ON CONFLICT (zodu_id, branch_id, doc_type)
    DO UPDATE SET last_seq = tbl_doc_id_seq.last_seq + 1
    RETURNING last_seq INTO next_seq;

    NEW.counter_code := 'KOT' || next_seq;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_kot_counter_code ON tbl_kot_counter;

CREATE TRIGGER trg_set_kot_counter_code
    BEFORE INSERT ON tbl_kot_counter
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_kot_counter_code();

ALTER TABLE tbl_menu_items
    ADD COLUMN IF NOT EXISTS kot_counter_id INT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_menu_items_kot_counter'
    ) THEN
        ALTER TABLE tbl_menu_items
            ADD CONSTRAINT fk_menu_items_kot_counter FOREIGN KEY (kot_counter_id)
            REFERENCES tbl_kot_counter(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_menu_items_kot_counter
    ON tbl_menu_items (kot_counter_id);
