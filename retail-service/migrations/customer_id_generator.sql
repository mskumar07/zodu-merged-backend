-- Auto-generates a unique cust_id ("CUS-######", 6 random digits) for
-- tbl_customer on INSERT, entirely in the database — the app no longer
-- needs to compute it. Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.

-- 1. Ensure the column exists (no-op if already present)
ALTER TABLE tbl_customer
    ADD COLUMN IF NOT EXISTS cust_id VARCHAR(20);

-- 1b. Drop the existing sequence default (e.g. nextval('tbl_customer_cust_id_seq'))
--     so the column comes in NULL on insert and the trigger below can fill it
--     with the CUS-###### format instead of a plain integer string.
ALTER TABLE tbl_customer
    ALTER COLUMN cust_id DROP DEFAULT;

-- 2. Enforce uniqueness so the trigger's collision retry loop is reliable
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_customer_cust_id
    ON tbl_customer (cust_id);

-- 3. Trigger function: on insert, if cust_id wasn't supplied, generate
--    CUS-<6 random digits>, retrying on the rare collision
CREATE OR REPLACE FUNCTION fn_set_customer_id()
RETURNS TRIGGER AS $$
DECLARE
    candidate VARCHAR(20);
    tries     INTEGER := 0;
BEGIN
    IF NEW.cust_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    LOOP
        candidate := 'CUS-' || LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
        tries := tries + 1;

        IF NOT EXISTS (SELECT 1 FROM tbl_customer WHERE cust_id = candidate) THEN
            NEW.cust_id := candidate;
            EXIT;
        END IF;

        IF tries >= 20 THEN
            RAISE EXCEPTION 'Could not generate a unique cust_id after % attempts', tries;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_customer_id ON tbl_customer;

CREATE TRIGGER trg_set_customer_id
    BEFORE INSERT ON tbl_customer
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_customer_id();

-- 4. Backfill cust_id for any existing rows that don't have one yet
DO $$
DECLARE
    r         RECORD;
    candidate VARCHAR(20);
    tries     INTEGER;
BEGIN
    FOR r IN SELECT cust_uuid FROM tbl_customer WHERE cust_id IS NULL LOOP
        tries := 0;
        LOOP
            candidate := 'CUS-' || LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
            tries := tries + 1;

            IF NOT EXISTS (SELECT 1 FROM tbl_customer WHERE cust_id = candidate) THEN
                UPDATE tbl_customer SET cust_id = candidate WHERE cust_uuid = r.cust_uuid;
                EXIT;
            END IF;

            IF tries >= 20 THEN
                RAISE EXCEPTION 'Could not generate a unique cust_id for %', r.cust_uuid;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;
