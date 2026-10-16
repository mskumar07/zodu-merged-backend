-- Purchase returns / debit notes.
--
-- A return reduces what we owe the vendor. The amount is split when it is created:
--   adjusted_amount -- taken off what we still owe on that purchase (no cash moves)
--   refund_due      -- cash the vendor owes us, because we had already paid
--   return_amount = adjusted_amount + refund_due
-- refunded_amount is how much of refund_due has actually come back, built up from
-- tbl_purchase_return_payment rows (one return can be refunded in instalments).
--
--   refund_status: NA (nothing owed) | PENDING | PARTIAL | REFUNDED
--   return_type:   PURCHASE_RETURN | DEBIT_NOTE (both take stock out)
--
-- The original purchase tables are never changed by a return: how much was bought
-- stays on tbl_purchase_items, and what has been returned lives only here.
--
-- Item name / unit / HSN / price / GST rate are copied onto the return line when it
-- is posted, so the document does not change if the menu is edited later.
--
-- No foreign key to tbl_purchase on purpose: this file must run unchanged in every
-- service that has the purchase tables, and the unique (zodu_id, purchase_id) key a
-- FK needs is not present everywhere. The purchase service blocks editing or
-- cancelling a purchase that has returns instead.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS tbl_purchase_returns (
    return_uuid          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id            VARCHAR(50)   NOT NULL,
    return_type          VARCHAR(15)   NOT NULL DEFAULT 'PURCHASE_RETURN'
                         CHECK (return_type IN ('PURCHASE_RETURN', 'DEBIT_NOTE')),
    zodu_id              VARCHAR(50)   NOT NULL,
    branch_id            VARCHAR(50)   NOT NULL,
    original_purchase_id VARCHAR(50)   NOT NULL,
    return_reason        TEXT,
    notes                TEXT,
    refund_type          VARCHAR(50),
    subtotal             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_tax            NUMERIC(14,2) NOT NULL DEFAULT 0,
    return_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    adjusted_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    refund_due           NUMERIC(14,2) NOT NULL DEFAULT 0,
    refunded_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    refund_status        VARCHAR(10)   NOT NULL DEFAULT 'NA'
                         CHECK (refund_status IN ('NA', 'PENDING', 'PARTIAL', 'REFUNDED')),
    return_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
    created_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    created_by           VARCHAR(100),
    CONSTRAINT uq_purchase_return_id UNIQUE (zodu_id, branch_id, return_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase
    ON tbl_purchase_returns (zodu_id, original_purchase_id);

CREATE TABLE IF NOT EXISTS tbl_purchase_return_items (
    id               SERIAL        PRIMARY KEY,
    return_uuid      UUID          NOT NULL REFERENCES tbl_purchase_returns (return_uuid) ON DELETE CASCADE,
    original_item_id INT           NOT NULL,
    item_id          VARCHAR(50),
    item_uuid        UUID,
    item_name        VARCHAR(150)  NOT NULL,
    unit             VARCHAR(50),
    hsn_code         VARCHAR(20),
    gst_percentage   NUMERIC(5,2),
    purchase_price   NUMERIC(12,2) NOT NULL,
    original_qty     NUMERIC(12,2) NOT NULL,
    return_qty       NUMERIC(12,2) NOT NULL CHECK (return_qty > 0),
    taxable_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    cgst             NUMERIC(14,2) NOT NULL DEFAULT 0,
    sgst             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount     NUMERIC(14,2) GENERATED ALWAYS AS (taxable_amount + tax_amount) STORED,
    created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return
    ON tbl_purchase_return_items (return_uuid);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_original
    ON tbl_purchase_return_items (original_item_id);

-- Refunds received from the vendor (money coming IN, unlike tbl_purchase_payment).
CREATE TABLE IF NOT EXISTS tbl_purchase_return_payment (
    id            SERIAL        PRIMARY KEY,
    return_uuid   UUID          NOT NULL REFERENCES tbl_purchase_returns (return_uuid) ON DELETE CASCADE,
    zodu_id       VARCHAR(50)   NOT NULL,
    branch_id     VARCHAR(50)   NOT NULL,
    refund_amount NUMERIC(14,2) NOT NULL CHECK (refund_amount > 0),
    payment_mode  VARCHAR(50)   NOT NULL,
    reference_no  VARCHAR(100),
    refund_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_payment_return
    ON tbl_purchase_return_payment (return_uuid);
