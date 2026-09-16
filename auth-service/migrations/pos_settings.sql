-- Adds tbl_pos_settings: one settings row per (zodu_id, branch_id), backing
-- the "POS settings" screen — which sale types the POS offers (Invoice,
-- Quotation, Proforma) and which one opens by default.
--
-- Modelled directly on tbl_invoice_settings (see invoice_settings.sql):
-- same one-row-per-branch shape, same FK to tbl_business, same
-- updated_at trigger, same backfill-for-existing-branches step.
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS tbl_pos_settings (
    id                  SERIAL PRIMARY KEY,
    zodu_id             VARCHAR(50) NOT NULL,
    branch_id           VARCHAR(50) NOT NULL,

    -- Which sale types the POS screen offers. A branch that never quotes or
    -- doesn't do proforma invoices can turn those tabs off entirely.
    pos_types           TEXT[] NOT NULL DEFAULT ARRAY['Invoice', 'Quotation', 'Proforma']::TEXT[],

    -- Which of the enabled types the POS screen opens on by default.
    default_pos_type    VARCHAR(20) NOT NULL DEFAULT 'Invoice',

    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pos_settings_zodu_id FOREIGN KEY (zodu_id)
        REFERENCES tbl_business(zodu_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT uq_pos_settings_zodu_branch UNIQUE (zodu_id, branch_id),

    -- Same two guards as tbl_invoice_settings.payment_types: no unknown
    -- label, and never an empty list (POS needs at least one sale type).
    CONSTRAINT chk_pos_settings_pos_types CHECK (
        COALESCE(array_length(pos_types, 1), 0) >= 1
        AND pos_types <@ ARRAY['Invoice', 'Quotation', 'Proforma']::TEXT[]
    ),

    CONSTRAINT chk_pos_settings_default_pos_type CHECK (
        default_pos_type = ANY (ARRAY['Invoice', 'Quotation', 'Proforma']::TEXT[])
    ),

    -- The default tab can't be one the branch has turned off.
    CONSTRAINT chk_pos_settings_default_in_types CHECK (
        default_pos_type = ANY (pos_types)
    )
);

-- Auto-update updated_at on every UPDATE, matching table conventions
CREATE OR REPLACE FUNCTION fn_touch_pos_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_pos_settings_updated_at ON tbl_pos_settings;

CREATE TRIGGER trg_touch_pos_settings_updated_at
    BEFORE UPDATE ON tbl_pos_settings
    FOR EACH ROW
    EXECUTE FUNCTION fn_touch_pos_settings_updated_at();

-- Backfill: seed a default settings row for every branch that already
-- exists and doesn't have one yet (branches created before this migration).
-- New branches going forward are seeded by business-repo.js's
-- createBranch / createDefaultBranch.
INSERT INTO tbl_pos_settings (zodu_id, branch_id)
SELECT b.zodu_id, b.branch_id
FROM tbl_branch b
ON CONFLICT (zodu_id, branch_id) DO NOTHING;
