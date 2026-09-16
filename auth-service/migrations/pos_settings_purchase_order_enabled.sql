-- Lets a branch show/hide the Purchase Order No/Date fields (tbl_sales.purchase_order_no
-- /purchase_order_date, see retail-service/migrations/sales_purchase_order.sql) on the POS
-- screen. Defaults TRUE since those columns are already live and usable — defaulting FALSE
-- would silently hide an already-shipped feature for every existing branch.
ALTER TABLE tbl_pos_settings
  ADD COLUMN IF NOT EXISTS purchase_order_enabled BOOLEAN NOT NULL DEFAULT TRUE;
