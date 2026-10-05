-- Separate terms & conditions for quotations and proformas.
--
-- Each is a toggle plus its own text. With the toggle on, that document type
-- prints its own terms instead of the general terms_conditions; with it off,
-- it prints the general terms exactly as before (subject to
-- show_terms_conditions). Invoices always use the general terms.
--
-- Same 2000-character cap as terms_conditions, enforced in the Joi schema.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_quotation_terms BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quotation_terms      TEXT,
    ADD COLUMN IF NOT EXISTS show_proforma_terms  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS proforma_terms       TEXT;
