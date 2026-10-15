-- Sale return / credit note refund tracking.
--
-- A return amount is split into two parts when it is created:
--   adjusted_amount  -- netted against what the customer still owes on the invoice (no cash moves)
--   refund_due       -- cash we owe the customer because they had already paid
--   return_amount = adjusted_amount + refund_due
-- refunded_amount is how much of refund_due has actually been paid out, built up
-- from tbl_sale_return_payment rows (one return can be refunded in instalments).
--
--   refund_status: NA (nothing owed) | PENDING | PARTIAL | REFUNDED
--   return_type:   SALES_RETURN | CREDIT_NOTE (both put stock back)
--
-- Existing rows default to SALES_RETURN / NA, so historical returns are untouched.
-- Safe to re-run.

ALTER TABLE tbl_sale_returns
    ADD COLUMN IF NOT EXISTS return_type     VARCHAR(15)   NOT NULL DEFAULT 'SALES_RETURN'
        CHECK (return_type IN ('SALES_RETURN', 'CREDIT_NOTE')),
    ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_due      NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_status   VARCHAR(10)   NOT NULL DEFAULT 'NA'
        CHECK (refund_status IN ('NA', 'PENDING', 'PARTIAL', 'REFUNDED'));

CREATE INDEX IF NOT EXISTS idx_sale_returns_original_sale
    ON tbl_sale_returns (original_sale_uuid);

CREATE TABLE IF NOT EXISTS tbl_sale_return_payment (
    id            SERIAL        PRIMARY KEY,
    return_uuid   UUID          NOT NULL REFERENCES tbl_sale_returns (return_uuid) ON DELETE CASCADE,
    zodu_id       VARCHAR(50)   NOT NULL,
    branch_id     VARCHAR(50)   NOT NULL,
    refund_amount NUMERIC(18,2) NOT NULL CHECK (refund_amount > 0),
    payment_mode  VARCHAR(50)   NOT NULL,
    reference_no  VARCHAR(100),
    refund_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sale_return_payment_return
    ON tbl_sale_return_payment (return_uuid);
