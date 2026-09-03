-- Adds invoice_template: which invoice layout a branch prints with.
--
-- Deliberately an unconstrained TEXT column, unlike invoice_theme_color and
-- payment_types which carry CHECK constraints — the set of templates is owned
-- by the frontend and will grow, so pinning a vocabulary in the database would
-- mean a migration every time a layout is added. NULL means "not chosen yet",
-- and the renderer falls back to its own default.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS invoice_template TEXT;
