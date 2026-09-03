-- Adds the company logo image to tbl_business.
--
-- Stores the URL of an image uploaded to MinIO (the same bucket the invoice
-- signature uses), not the image bytes: the logo is rendered by invoice
-- templates and the web UI as a plain <img src>. NULL means "no logo uploaded".
--
-- Pairs with tbl_invoice_settings.show_company_logo, which decides whether the
-- invoice prints the logo at all — the logo itself belongs to the company, not
-- to one branch's invoice settings, so it lives here.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_business
    ADD COLUMN IF NOT EXISTS company_logo_url TEXT;
