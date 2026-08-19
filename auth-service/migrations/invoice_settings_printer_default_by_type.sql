-- Makes tbl_invoice_settings.printer_inch default by company module instead
-- of a flat '3 Inch' for everyone:
--   tbl_business.type = 'Retail'      -> 'A4'
--   tbl_business.type = 'Restaurant'  -> '3 Inch'  (also the fallback)
--
-- Applies automatically on every INSERT that doesn't explicitly pass
-- printer_inch — including the existing seed inserts in business-repo.js's
-- createBranch / createDefaultBranch (`INSERT INTO tbl_invoice_settings
-- (zodu_id, branch_id) VALUES ($1, $2)`), so no application code changes
-- needed there.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses CREATE OR REPLACE / DROP TRIGGER IF EXISTS guards.

CREATE OR REPLACE FUNCTION fn_default_invoice_settings_printer_inch()
RETURNS TRIGGER AS $$
DECLARE
    company_type VARCHAR(50);
BEGIN
    -- Only fill in when the caller didn't explicitly set printer_inch
    -- (i.e. it's still sitting at the plain column default).
    IF NEW.printer_inch IS NULL OR NEW.printer_inch = '3 Inch' THEN
        SELECT type INTO company_type FROM tbl_business WHERE zodu_id = NEW.zodu_id;

        IF company_type = 'Retail' THEN
            NEW.printer_inch := 'A4';
        ELSE
            NEW.printer_inch := '3 Inch';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_default_invoice_settings_printer_inch ON tbl_invoice_settings;

CREATE TRIGGER trg_default_invoice_settings_printer_inch
    BEFORE INSERT ON tbl_invoice_settings
    FOR EACH ROW
    EXECUTE FUNCTION fn_default_invoice_settings_printer_inch();

-- Backfill: correct printer_inch for existing rows that are still sitting at
-- the untouched default, based on their company's type.
UPDATE tbl_invoice_settings s
SET printer_inch = 'A4'
FROM tbl_business b
WHERE s.zodu_id = b.zodu_id
  AND b.type = 'Retail'
  AND s.printer_inch = '3 Inch';
