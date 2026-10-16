-- Discounts and round-off on sale returns / credit notes.
--
-- An invoice can carry a line discount (tbl_sale_items.discount) and an
-- order-level discount (tbl_sales.discount_amount). A return must hand back only
-- what the customer actually paid, so each returned line now records its share:
--
--   tbl_sale_return_items.discount_amount -- line discount + share of the order discount
--   tbl_sale_returns.discount_amount      -- sum of the above
--
-- Invoices are also rounded to a whole rupee at billing (items worth 1,162.66
-- billed as 1,163). Without a share of that rounding, returning everything left
-- the paise behind: an unpaid invoice kept a tiny balance due, a paid one
-- under-refunded the customer. Each return carries its proportional share:
--
--   tbl_sale_returns.round_off
--
-- return_amount = subtotal - discount_amount + total_tax + round_off
--
-- Existing returns default to 0: they were created before discounts and
-- round-off were accounted for and keep the amounts they were issued with.
-- Safe to re-run.

ALTER TABLE tbl_sale_returns
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS round_off       NUMERIC(18,2) NOT NULL DEFAULT 0;

ALTER TABLE tbl_sale_return_items
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
