-- tbl_kot_list had no public_order_no column. Takeaway/Delivery orders get
-- their public_order_no at creation (tbl_orders, generatePublicOrderNo) but
-- it was never carried onto the KOT list rows, so the KDS board couldn't
-- show it against the ticket.
--
-- Run this once against the service's database.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op if it already exists.

ALTER TABLE tbl_kot_list
    ADD COLUMN IF NOT EXISTS public_order_no VARCHAR(50);
