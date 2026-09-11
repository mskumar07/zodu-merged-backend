-- Fixes two globally-unique constraints that should have been scoped per
-- tenant (zodu_id), same bug class as customer_id_sequence.sql fixed for
-- tbl_customer.cust_id:
--
--   tbl_purchase.purchase_id  — had UNIQUE(purchase_id) alone
--   tbl_expense.expense_id    — was literally the PRIMARY KEY
--
-- purchase_id/expense_id are now per-(zodu_id, branch_id) sequential codes
-- (PUR-<branch_id>-001, EXP-<branch_id>-001, see
-- purchase_expense_id_sequence.sql) — meant to repeat once per tenant. Two
-- different zodu_id values sharing branch_id "B1" both legitimately produce
-- "PUR-B1-001" / "EXP-B1-001". A global uniqueness rule throws spurious
-- "duplicate key value violates unique constraint" errors the moment a
-- second tenant reuses a branch code — reproduced live 2026-09-11 for both
-- tbl_purchase and tbl_expense.
--
-- tbl_expense needed more than an index swap: expense_id was the actual
-- PRIMARY KEY, so every FK pointing at it had to be repointed to a
-- composite (zodu_id, expense_id) key instead. tbl_expense already had an
-- unused serial `id` column, clearly meant to be the real PK — promoted to
-- PRIMARY KEY here so the shift matches how tbl_purchase already uses `id`
-- as its true PK internally.
--
-- tbl_expense_menu_items is a SEPARATE, unrelated table (branch-scoped menu
-- catalog) with no FK to tbl_expense — confirmed via live schema, not
-- touched by this migration.
--
-- Run this once against the shared database (retail_restaurant_service /
-- restaurant_service — same structure verified live in both, run once per
-- database). Safe to re-run: guarded DROP/ADD with IF EXISTS / duplicate
-- checks.

-- ── tbl_purchase.purchase_id ─────────────────────────────────────────────
-- purchase_id is NOT the PK on tbl_purchase (tbl_purchase.id is) — just an
-- index swap there. tbl_purchase_items' own PK is purchase_item_id
-- (unaffected, already correct) — but it has no zodu_id column (confirmed
-- live 2026-09-11), needed for the new composite FK. tbl_purchase_payment
-- already carries zodu_id directly.

ALTER TABLE tbl_purchase_items   DROP CONSTRAINT IF EXISTS fk_purchase_items_purchase;
ALTER TABLE tbl_purchase_payment DROP CONSTRAINT IF EXISTS fk_purchase_payment_purchase;

-- Drops the constraint AND its backing index in one step — a plain
-- DROP INDEX on a constraint-backed index fails ("requires it") since the
-- constraint still depends on it.
ALTER TABLE tbl_purchase DROP CONSTRAINT IF EXISTS tbl_purchase_purchase_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_purchase_zodu_purchase_id
    ON tbl_purchase (zodu_id, purchase_id);

-- Add + backfill zodu_id on tbl_purchase_items, same pattern as
-- tbl_expense_items below. purchase_item_id stays its PK — untouched.
ALTER TABLE tbl_purchase_items ADD COLUMN IF NOT EXISTS zodu_id VARCHAR(50);

UPDATE tbl_purchase_items pi
SET zodu_id = p.zodu_id
FROM tbl_purchase p
WHERE pi.purchase_id = p.purchase_id
  AND pi.zodu_id IS NULL;

ALTER TABLE tbl_purchase_items
    ADD CONSTRAINT fk_purchase_items_purchase
    FOREIGN KEY (zodu_id, purchase_id) REFERENCES tbl_purchase (zodu_id, purchase_id)
    ON DELETE CASCADE;

ALTER TABLE tbl_purchase_payment
    ADD CONSTRAINT fk_purchase_payment_purchase
    FOREIGN KEY (zodu_id, purchase_id) REFERENCES tbl_purchase (zodu_id, purchase_id)
    ON DELETE CASCADE;

-- ── tbl_expense.expense_id ───────────────────────────────────────────────
-- expense_id WAS the PK — swap the PK to the existing unused `id` column,
-- then make expense_id a tenant-scoped unique index, and repoint FKs.

ALTER TABLE tbl_expense_items   DROP CONSTRAINT IF EXISTS tbl_expense_items_expense_id_fkey;
ALTER TABLE tbl_expense_payment DROP CONSTRAINT IF EXISTS tbl_expense_payment_expense_id_fkey;

ALTER TABLE tbl_expense DROP CONSTRAINT IF EXISTS tbl_expense_pkey;
ALTER TABLE tbl_expense ADD CONSTRAINT tbl_expense_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_expense_zodu_expense_id
    ON tbl_expense (zodu_id, expense_id);

-- tbl_expense_payment already carries zodu_id; tbl_expense_items does not
-- (confirmed live: id, expense_id, item_id, item_name, qty, price, subtotal,
-- category_id, created_at — no zodu_id/branch_id). Add it, backfill from the
-- parent via expense_id (still unique enough for this one-time backfill,
-- since it's running before any cross-tenant collision could have occurred
-- in existing data), then enforce NOT NULL so the composite FK is valid.
ALTER TABLE tbl_expense_items ADD COLUMN IF NOT EXISTS zodu_id VARCHAR(50);

UPDATE tbl_expense_items ei
SET zodu_id = e.zodu_id
FROM tbl_expense e
WHERE ei.expense_id = e.expense_id
  AND ei.zodu_id IS NULL;

ALTER TABLE tbl_expense_items ALTER COLUMN zodu_id SET NOT NULL;

ALTER TABLE tbl_expense_items
    ADD CONSTRAINT tbl_expense_items_expense_id_fkey
    FOREIGN KEY (zodu_id, expense_id) REFERENCES tbl_expense (zodu_id, expense_id)
    ON DELETE CASCADE;

ALTER TABLE tbl_expense_payment
    ADD CONSTRAINT tbl_expense_payment_expense_id_fkey
    FOREIGN KEY (zodu_id, expense_id) REFERENCES tbl_expense (zodu_id, expense_id)
    ON DELETE CASCADE;
