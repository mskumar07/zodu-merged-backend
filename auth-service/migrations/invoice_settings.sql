-- Adds tbl_invoice_settings: one settings row per (zodu_id, branch_id),
-- backing the "Invoice settings" screen (numbering, tax, payment, print layout).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses IF NOT EXISTS guards.
--
-- Auth-service is the source of truth for tbl_business / tbl_branch here.
-- restaurant-service has no local branch table — it reaches this data (and
-- will reach invoice settings) over HTTP via src/utils/authClient.js hitting
-- this service's /internal/* routes.

CREATE TABLE IF NOT EXISTS tbl_invoice_settings (
    id                          SERIAL PRIMARY KEY,
    zodu_id                     VARCHAR(50) NOT NULL,
    branch_id                   VARCHAR(50) NOT NULL,

    -- Invoice Numbering
    invoice_prefix              VARCHAR(20) NOT NULL DEFAULT 'INV',
    invoice_digit_count         SMALLINT NOT NULL DEFAULT 4,
    invoice_start_number        INTEGER NOT NULL DEFAULT 1,

    -- Tax Settings
    default_tax_label           VARCHAR(50) NOT NULL DEFAULT 'GST 18%',

    -- Payment Settings
    invoice_due_days            SMALLINT NOT NULL DEFAULT 15,
    default_payment_method      VARCHAR(30) NOT NULL DEFAULT 'Cash',

    -- Print Layout
    printer_inch                VARCHAR(10) NOT NULL DEFAULT '3 Inch',
    show_company_logo           BOOLEAN NOT NULL DEFAULT TRUE,
    print_thank_you_message     BOOLEAN NOT NULL DEFAULT TRUE,

    active                      BOOLEAN DEFAULT TRUE,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_invoice_settings_zodu_id FOREIGN KEY (zodu_id)
        REFERENCES tbl_business(zodu_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT uq_invoice_settings_zodu_branch UNIQUE (zodu_id, branch_id)
);

-- Auto-update updated_at on every UPDATE, matching table conventions
CREATE OR REPLACE FUNCTION fn_touch_invoice_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_invoice_settings_updated_at ON tbl_invoice_settings;

CREATE TRIGGER trg_touch_invoice_settings_updated_at
    BEFORE UPDATE ON tbl_invoice_settings
    FOR EACH ROW
    EXECUTE FUNCTION fn_touch_invoice_settings_updated_at();

-- Backfill: seed a default settings row for every branch that already
-- exists and doesn't have one yet (branches created before this migration).
-- New branches going forward are seeded by business-repo.js's
-- createBranch / createDefaultBranch.
INSERT INTO tbl_invoice_settings (zodu_id, branch_id)
SELECT b.zodu_id, b.branch_id
FROM tbl_branch b
ON CONFLICT (zodu_id, branch_id) DO NOTHING;
