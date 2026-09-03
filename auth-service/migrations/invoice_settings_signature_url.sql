-- Adds the authorised-signature image to tbl_invoice_settings.
--
-- Stores the URL of an image uploaded to MinIO (the same bucket the other
-- services use), not the image bytes: invoices are rendered as HTML/PDF and
-- the template just needs a src. NULL means "no signature uploaded yet".
--
-- Pairs with the existing show_signature flag, which decides whether the
-- invoice prints a signature block at all.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS signature_url TEXT;
