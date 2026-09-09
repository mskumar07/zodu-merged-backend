-- Switches tbl_customer.cust_id from the old random "CUS-######" format
-- to a sequential, branch-scoped format: CUS-<branch_id>-001, CUS-<branch_id>-002, ...
--
-- Reuses the same tbl_doc_id_seq counter table introduced in
-- purchase_expense_id_sequence.sql, with doc_type = 'CUS'. Sequence is
-- scoped per (zodu_id, branch_id): two different zodu_id tenants using the
-- same branch_id (e.g. "B1") each start at 001 independently.
--
-- Run this once against the shared database (restaurant_service / retail_service,
-- same physical schema). Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE guards.
--
-- NOTE: no backfill — existing customers keep their old "CUS-######" cust_id
-- as-is; tbl_doc_id_seq is not seeded from existing rows, so the first new
-- customer created per (zodu_id, branch_id) after this migration gets 001.
--
-- This REPLACES the old random-id generator from customer_id_generator.sql:
-- fn_set_customer_id / trg_set_customer_id are the same names that migration
-- created, so CREATE OR REPLACE + DROP/CREATE TRIGGER below fully overwrite
-- that old logic — nothing from the old generator keeps running afterward.

-- 0. Drop the leftover auto-increment sequence, if the column still has one
--    from before customer_id_generator.sql first ran (that migration only
--    dropped the column DEFAULT, not the sequence object itself)
DROP SEQUENCE IF EXISTS tbl_customer_cust_id_seq;

-- 1. Same counter table used by purchase/expense sequences (safe if it
--    already exists from that migration)
CREATE TABLE IF NOT EXISTS tbl_doc_id_seq (
    zodu_id     VARCHAR(50) NOT NULL,
    branch_id   VARCHAR(50) NOT NULL,
    doc_type    VARCHAR(20) NOT NULL,   -- 'PUR', 'EXP', 'CUS', ...
    last_seq    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (zodu_id, branch_id, doc_type)
);

-- 2. Trigger function: on insert, if cust_id wasn't supplied, atomically
--    bump the counter for (zodu_id, branch_id, 'CUS') and stamp
--    cust_id = CUS-<branch_id>-<seq:03d>
CREATE OR REPLACE FUNCTION fn_set_customer_id()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INTEGER;
BEGIN
    IF NEW.cust_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
    VALUES (NEW.zodu_id, NEW.branch_id, 'CUS', 1)
    ON CONFLICT (zodu_id, branch_id, doc_type)
    DO UPDATE SET last_seq = tbl_doc_id_seq.last_seq + 1
    RETURNING last_seq INTO next_seq;

    NEW.cust_id := 'CUS-' || NEW.branch_id || '-' || LPAD(next_seq::text, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- trg_set_customer_id + fn_set_customer_id already exist from
-- customer_id_generator.sql — CREATE OR REPLACE above swaps the logic,
-- the trigger binding itself doesn't need to change.
DROP TRIGGER IF EXISTS trg_set_customer_id ON tbl_customer;

CREATE TRIGGER trg_set_customer_id
    BEFORE INSERT ON tbl_customer
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_customer_id();
