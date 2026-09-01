-- Adds a free-text `description` to menu items and carries it onto the sale
-- documents, so the text printed on an invoice is the one that was current
-- when the sale happened rather than whatever the menu item says today.
--
--   tbl_menu_items        -- the master value, edited on the item screen
--   tbl_sale_items        -- snapshot taken at billing time
--   tbl_sale_return_items -- snapshot copied from the original sale line
--
-- Pairs with tbl_invoice_settings.show_description in auth-service, which
-- decides whether the invoice template prints this column at all.
--
-- Run this once against the service's database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_menu_items
    ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE tbl_sale_items
    ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE tbl_sale_return_items
    ADD COLUMN IF NOT EXISTS description TEXT;
