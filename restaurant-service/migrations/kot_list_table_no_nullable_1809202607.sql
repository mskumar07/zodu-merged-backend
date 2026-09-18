-- tbl_kot_list.table_no was NOT NULL, but non-Dine-In orders (Takeaway,
-- Delivery, ...) have no table — createKOT (orders-repo.js) passes table_no
-- as NULL for those, and the insert 500s on the not-null constraint.
--
-- Run this once against the service's database.
-- Safe to re-run: DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE tbl_kot_list
    ALTER COLUMN table_no DROP NOT NULL;


ALTER TABLE tbl_kot_list
    DROP CONSTRAINT IF EXISTS fk_kot_tmp_orders_api;

ALTER TABLE tbl_kot_list
    ADD COLUMN IF NOT EXISTS order_type VARCHAR(50);

