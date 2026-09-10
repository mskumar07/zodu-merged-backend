-- Adds the customer's purchase order reference to tbl_sales — the PO number
-- and date the customer quoted when placing the order, printed on the
-- invoice alongside the sale's own sale_id/sale_date.
--
-- Run this once against the retail_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_sales
    ADD COLUMN IF NOT EXISTS purchase_order_no VARCHAR(50),
    ADD COLUMN IF NOT EXISTS purchase_order_date DATE;
