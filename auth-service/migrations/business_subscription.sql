-- Adds subscription tracking to tbl_business: is_subscripted flag,
-- subscription_start_date (registration timestamp) and
-- subscription_expiry_date (start + 5 years). Safe to re-run.

ALTER TABLE tbl_business
    ADD COLUMN IF NOT EXISTS is_subscripted            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS subscription_start_date   TIMESTAMP,
    ADD COLUMN IF NOT EXISTS subscription_expiry_date  TIMESTAMP;

-- Backfill existing rows: start = created_at (or now()), expiry = start + 5 years
UPDATE tbl_business
SET subscription_start_date  = COALESCE(subscription_start_date, created_at, now()),
    subscription_expiry_date = COALESCE(subscription_expiry_date, COALESCE(created_at, now()) + INTERVAL '5 years')
WHERE subscription_start_date IS NULL
   OR subscription_expiry_date IS NULL;
