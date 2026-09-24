-- Adds the "Payment Types" multi-select from the invoice settings screen:
-- which payment types a branch offers at POS checkout.
--
-- Stored as TEXT[] rather than a child table — it is a short, fixed vocabulary
-- with no attributes of its own, and node-postgres maps a TEXT[] straight to
-- and from a JS array, so the settings row stays a single round trip.
--
-- The labels are the ones the UI shows, and match the payment_mode vocabulary
-- already used in retail-service's mark_payment schema.
--
-- Default is every type: before this column existed the POS had no filter, so
-- an untouched branch keeps offering everything it does today.
--
-- The CHECK stops two states the checkout screen cannot render: an unknown
-- label, and an empty list (no way to take payment at all).
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.

ALTER TABLE tbl_invoice_settings
    ADD COLUMN IF NOT EXISTS payment_types TEXT[] NOT NULL
    DEFAULT ARRAY['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Others']::TEXT[];

-- Drop the now-unsupported "UPI + Cash" label from any row that already has
-- it (an earlier default included it before this vocabulary was finalized),
-- so the CHECK constraint below can be added without failing on old rows.
UPDATE tbl_invoice_settings
SET payment_types = array_remove(payment_types, 'UPI + Cash')
WHERE 'UPI + Cash' = ANY(payment_types);

ALTER TABLE tbl_invoice_settings
    DROP CONSTRAINT IF EXISTS chk_invoice_settings_payment_types;

ALTER TABLE tbl_invoice_settings
    ADD CONSTRAINT chk_invoice_settings_payment_types
    CHECK (
        COALESCE(array_length(payment_types, 1), 0) >= 1
        AND payment_types <@ ARRAY['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Others']::TEXT[]
    );
