-- Per-document-type invoice settings for Retail companies.
--
-- Before: ONE tbl_invoice_settings row per (zodu_id, branch_id).
-- After:  one row per (zodu_id, branch_id, document_type), where
--           document_type IN ('invoice', 'quotation', 'proforma')
--         Retail companies get all three rows (seeded on company/branch create
--         by business-repo.js); every other business type (Restaurant) keeps
--         exactly one 'invoice' row.
--
-- Existing data: every current row becomes document_type = 'invoice' via the
-- column DEFAULT. Nothing is copied into quotation/proforma and Restaurant
-- rows are not touched — a retail branch that predates this migration gets its
-- quotation/proforma row (defaults) lazily, the first time the screen opens it
-- (see GetInvoiceSettings / ensureInvoiceSettings).
--
-- Why the uniqueness swap matters: the app upserts with
--   ON CONFLICT (zodu_id, branch_id, document_type)
-- which Postgres rejects unless a matching unique constraint exists.
--
-- Run once against the auth-service database. Safe to re-run.

BEGIN;

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS document_type VARCHAR(10) NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_settings_document_type') THEN
        ALTER TABLE tbl_invoice_settings
            ADD CONSTRAINT chk_invoice_settings_document_type
            CHECK (document_type IN ('invoice', 'quotation', 'proforma'));
    END IF;

    -- Add the new key first, then drop the old one, so the table is never
    -- without a uniqueness guarantee.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_settings_zodu_branch_doc') THEN
        ALTER TABLE tbl_invoice_settings
            ADD CONSTRAINT uq_invoice_settings_zodu_branch_doc
            UNIQUE (zodu_id, branch_id, document_type);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_settings_zodu_branch') THEN
        ALTER TABLE tbl_invoice_settings DROP CONSTRAINT uq_invoice_settings_zodu_branch;
    END IF;
END;
$$;

-- Re-point the printer_inch default trigger (see
-- invoice_settings_printer_default_by_type.sql) at the new key: "does this row
-- already exist" now means (zodu_id, branch_id, document_type), otherwise the
-- quotation/proforma inserts would be mistaken for updates of the invoice row
-- and skip the A4 default for Retail.
CREATE OR REPLACE FUNCTION fn_default_invoice_settings_printer_inch()
RETURNS TRIGGER AS $$
DECLARE
    company_type VARCHAR(50);
BEGIN
    IF EXISTS (
        SELECT 1 FROM tbl_invoice_settings
        WHERE zodu_id = NEW.zodu_id
          AND branch_id = NEW.branch_id
          AND document_type = NEW.document_type
    ) THEN
        RETURN NEW;
    END IF;

    IF NEW.printer_inch IS NULL OR NEW.printer_inch = '3 Inch' THEN
        SELECT type INTO company_type FROM tbl_business WHERE zodu_id = NEW.zodu_id;

        IF lower(company_type) = 'retail' THEN
            NEW.printer_inch := 'A4';
        ELSE
            NEW.printer_inch := '3 Inch';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
