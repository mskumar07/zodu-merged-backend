-- Adds the "Invoice Copy Types" multi-select from the invoice settings screen:
-- which copy labels a branch prints per sale — Original (for the customer),
-- Duplicate (the business's own copy), Transport Copy (for the delivery
-- vehicle). The frontend renders one printed copy per selected label.
--
-- Stored as TEXT[], same reasoning as payment_types: a short, fixed
-- vocabulary with no attributes of its own, and node-postgres maps a TEXT[]
-- straight to and from a JS array, so the settings row stays a single round
-- trip.
--
-- Default is just 'Original' — before this column existed a branch printed
-- one unlabeled copy, so an untouched branch keeps printing a single copy.
-- (Unlike payment_types, which defaulted to every type because POS already
-- accepted all of them before that column existed.)
--
-- The CHECK stops two states the print screen cannot render: an unknown
-- label, and an empty list (nothing to print).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS invoice_copy_types TEXT[] NOT NULL
    DEFAULT ARRAY['Original']::TEXT[];

ALTER TABLE tbl_invoice_settings
    DROP CONSTRAINT IF EXISTS chk_invoice_settings_copy_types;

ALTER TABLE tbl_invoice_settings
    ADD CONSTRAINT chk_invoice_settings_copy_types
    CHECK (
        COALESCE(array_length(invoice_copy_types, 1), 0) >= 1
        AND invoice_copy_types <@ ARRAY['Original', 'Duplicate', 'Transport']::TEXT[]
    );
