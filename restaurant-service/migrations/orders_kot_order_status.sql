-- Adds kot_order_status to tbl_orders so the kitchen order status (e.g.
-- Pending, Preparing, Ready, Served) can be tracked on the finalized order,
-- not just on the individual KOT tickets.
--
-- Run this once against the service's database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_orders
    ADD COLUMN IF NOT EXISTS kot_order_status VARCHAR(50);
