-- Adds a free-text `description` to menu items.
--
-- Pairs with tbl_invoice_settings.show_description in auth-service, which
-- decides whether the invoice template prints this column at all.
--
-- restaurant-service bills through tbl_orders / tbl_ordered_items, not through
-- tbl_sale_items — the sale tables only exist in the retail database. The repo
-- still carries tbl_sale_items / tbl_sale_return_items code paths, so the two
-- ALTERs below are guarded: they run where those tables exist and are skipped
-- silently where they don't, instead of aborting the migration.
--
-- The restaurant invoice reads the description from the joined tbl_menu_items
-- row, so tbl_ordered_items needs no column of its own — but that also means
-- it shows the item's CURRENT text, not a snapshot from billing time.
--
-- Run this once against the service's database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_menu_items
    ADD COLUMN IF NOT EXISTS description TEXT;

DO $$
BEGIN
    IF to_regclass('public.tbl_sale_items') IS NOT NULL THEN
        ALTER TABLE tbl_sale_items ADD COLUMN IF NOT EXISTS description TEXT;
    ELSE
        RAISE NOTICE 'tbl_sale_items not present in this database — skipped';
    END IF;

    IF to_regclass('public.tbl_sale_return_items') IS NOT NULL THEN
        ALTER TABLE tbl_sale_return_items ADD COLUMN IF NOT EXISTS description TEXT;
    ELSE
        RAISE NOTICE 'tbl_sale_return_items not present in this database — skipped';
    END IF;
END
$$;
