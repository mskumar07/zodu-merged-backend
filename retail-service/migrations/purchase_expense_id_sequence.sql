-- Auto-generates purchase_id / expense_id in the database on INSERT,
-- so the app no longer needs to build them with Date.now().
--
-- Format: PUR-<branch_id>-001, PUR-<branch_id>-002, ...
--         EXP-<branch_id>-001, EXP-<branch_id>-002, ...
--
-- Sequence is scoped per (zodu_id, branch_id) per doc type: two different
-- zodu_id tenants using the same branch_id (e.g. "B1") each start at 001
-- independently. Purchase and expense counters are independent of each other.
--
-- Run this once against the shared database (restaurant_service / retail_service,
-- same physical schema per the DBeaver screenshot). Safe to re-run: uses
-- IF NOT EXISTS / CREATE OR REPLACE guards.
--
-- NOTE: no backfill step — tbl_doc_id_seq starts empty, so every
-- (zodu_id, branch_id) begins its sequence at 001 from the first insert
-- after this migration runs, regardless of any existing rows.

-- 1. Counter table: one row per (zodu_id, branch_id, doc_type)
CREATE TABLE IF NOT EXISTS tbl_doc_id_seq (
    zodu_id     VARCHAR(50) NOT NULL,
    branch_id   VARCHAR(50) NOT NULL,
    doc_type    VARCHAR(20) NOT NULL,   -- 'PUR' or 'EXP'
    last_seq    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (zodu_id, branch_id, doc_type)
);

-- 2. Trigger function: on insert, if purchase_id wasn't supplied, atomically
--    bump the counter for (zodu_id, branch_id, 'PUR') and stamp
--    purchase_id = PUR-<branch_id>-<seq:03d>
CREATE OR REPLACE FUNCTION fn_set_purchase_id()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INTEGER;
BEGIN
    IF NEW.purchase_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
    VALUES (NEW.zodu_id, NEW.branch_id, 'PUR', 1)
    ON CONFLICT (zodu_id, branch_id, doc_type)
    DO UPDATE SET last_seq = tbl_doc_id_seq.last_seq + 1
    RETURNING last_seq INTO next_seq;

    NEW.purchase_id := 'PUR-' || NEW.branch_id || '-' || LPAD(next_seq::text, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_purchase_id ON tbl_purchase;

CREATE TRIGGER trg_set_purchase_id
    BEFORE INSERT ON tbl_purchase
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_purchase_id();

-- 3. Same for tbl_expense / expense_id, doc_type 'EXP'
CREATE OR REPLACE FUNCTION fn_set_expense_id()
RETURNS TRIGGER AS $$
DECLARE
    next_seq INTEGER;
BEGIN
    IF NEW.expense_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
    VALUES (NEW.zodu_id, NEW.branch_id, 'EXP', 1)
    ON CONFLICT (zodu_id, branch_id, doc_type)
    DO UPDATE SET last_seq = tbl_doc_id_seq.last_seq + 1
    RETURNING last_seq INTO next_seq;

    NEW.expense_id := 'EXP-' || NEW.branch_id || '-' || LPAD(next_seq::text, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_expense_id ON tbl_expense;

CREATE TRIGGER trg_set_expense_id
    BEFORE INSERT ON tbl_expense
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_expense_id();

-- No backfill: tbl_doc_id_seq starts empty, so the first insert for any
-- (zodu_id, branch_id) after this migration gets 001, regardless of how
-- many old-format rows already exist in tbl_purchase / tbl_expense.
