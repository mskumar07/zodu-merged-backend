
# Account creation query

CREATE TABLE tbl_account_creation (
    id SERIAL PRIMARY KEY,
    restaurant_name VARCHAR(100) NOT NULL,
    email VARCHAR(50) UNIQUE NOT NULL,
    phone_number BIGINT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
