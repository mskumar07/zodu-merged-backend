-- Moves subscription/trial tracking from company level (tbl_business) to
-- branch level (tbl_subscription), so each branch gets its own 14-day trial
-- and its own independent subscribe/expire lifecycle.
--
-- 1. Create tbl_subscription, one row per (zodu_id, branch_id).
-- 2. Backfill a row per existing branch from tbl_business's old company-wide
--    subscription window (best-effort continuity for existing customers).
-- 3. Drop the now-unused company-level columns from tbl_business.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS tbl_subscription (
    id                       SERIAL PRIMARY KEY,
    zodu_id                  VARCHAR(50) NOT NULL,
    branch_id                VARCHAR(20) NOT NULL,

    status                   VARCHAR(20) NOT NULL DEFAULT 'trial',
        -- 'trial' | 'active' | 'expired' | 'cancelled' | 'past_due'

    plan_code                VARCHAR(50),

    trial_start_date         TIMESTAMP,
    trial_end_date           TIMESTAMP,

    subscription_start_date  TIMESTAMP,
    subscription_end_date    TIMESTAMP,
    cancelled_at             TIMESTAMP,

    payment_provider         VARCHAR(30),
    payment_ref_id           VARCHAR(100),

    created_at               TIMESTAMP NOT NULL DEFAULT now(),
    updated_at               TIMESTAMP NOT NULL DEFAULT now(),

    UNIQUE (zodu_id, branch_id),
    FOREIGN KEY (zodu_id, branch_id) REFERENCES tbl_branch (zodu_id, branch_id) ON DELETE CASCADE
);

-- Backfill: one subscription row per existing branch, carried over from the
-- old company-wide window on tbl_business (falls back to now()/+14 days if
-- the company row or its dates are missing).
INSERT INTO tbl_subscription (zodu_id, branch_id, status, trial_start_date, trial_end_date)
SELECT br.zodu_id,
       br.branch_id,
       'active',
       COALESCE(bu.subscription_start_date, br.created_at, now()),
       COALESCE(bu.subscription_expiry_date, COALESCE(br.created_at, now()) + INTERVAL '14 days')
FROM tbl_branch br
LEFT JOIN tbl_business bu ON bu.zodu_id = br.zodu_id
ON CONFLICT (zodu_id, branch_id) DO NOTHING;

-- Company-level subscription fields are superseded by tbl_subscription.
ALTER TABLE tbl_business
    DROP COLUMN IF EXISTS is_subscripted,
    DROP COLUMN IF EXISTS subscription_start_date,
    DROP COLUMN IF EXISTS subscription_expiry_date;
