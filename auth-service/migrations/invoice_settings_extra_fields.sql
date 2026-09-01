-- Extends tbl_invoice_settings with the full "Invoice settings" screen:
-- configurable numbering (digit count / start number, which the original
-- invoice_settings.sql deliberately left out), the per-section print toggles,
-- and the two free-text blocks (terms & conditions, notes).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.

-- Invoice Numbering
ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS invoice_digit_count   SMALLINT NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS invoice_start_number  INTEGER  NOT NULL DEFAULT 1;

-- Print Layout — line item columns
ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_item_id          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_description      BOOLEAN NOT NULL DEFAULT FALSE;

-- Print Layout — invoice sections
ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_customer_details BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS show_tax_details      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS show_payment_details  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS show_bank_details     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_signature        BOOLEAN NOT NULL DEFAULT FALSE;

-- Free-text blocks — the text is only printed when its toggle is on
ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS show_terms_conditions BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS terms_conditions      TEXT,
    ADD COLUMN IF NOT EXISTS show_notes            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notes                 TEXT;
