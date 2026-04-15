
# Account creation query

CREATE SEQUENCE IF NOT EXISTS zodu_seq START 1;

CREATE TABLE tbl_account_creation (
    id SERIAL PRIMARY KEY,
    zodu_id VARCHAR(50) UNIQUE NOT NULL,
    restaurant_name VARCHAR(100) NOT NULL,
    email VARCHAR(50) UNIQUE NOT NULL,
    phone_number BIGINT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tbl_user_companies (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    zodu_id VARCHAR(50) NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    CONSTRAINT uq_user_zodu UNIQUE (user_id, zodu_id)
);

CREATE INDEX idx_user_companies_user ON tbl_user_companies(user_id);
CREATE INDEX idx_user_companies_zodu ON tbl_user_companies(zodu_id);

-- If tbl_users is in a different database, do not add a FOREIGN KEY here.
-- Cross-database referential integrity must be enforced in application logic.
