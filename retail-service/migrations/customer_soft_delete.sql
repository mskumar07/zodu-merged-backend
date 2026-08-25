-- Soft-delete support for tbl_customer: deleting a customer from the UI
-- marks them inactive instead of removing the row (preserves sale/purchase
-- history that references cust_uuid). Safe to re-run.

ALTER TABLE tbl_customer
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_tbl_customer_active
    ON tbl_customer (zodu_id, branch_id, is_active);
