-- Default units + GST rates for a new branch, seeded entirely on the DB side.
-- Unique indexes make the seed idempotent (ON CONFLICT DO NOTHING); the
-- function does both inserts as two set-based statements (no per-row
-- round-trips from the app) in one transaction. Safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_units_branch_name
    ON tbl_units (zodu_id, branch_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_gst_branch_rate
    ON tbl_gst (zodu_id, branch_id, gst_rate);

CREATE OR REPLACE FUNCTION seed_branch_defaults(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS VOID AS $$
BEGIN
    INSERT INTO tbl_units (zodu_id, branch_id, name, short_name)
    SELECT p_zodu_id, p_branch_id, v.name, v.short_name
    FROM (VALUES
        ('Piece',  'PCS'),
        ('Box',    'BOX'),
        ('Litre',  'LTR'),
        ('Number', 'NOS')
    ) AS v(name, short_name)
    ON CONFLICT (zodu_id, branch_id, name) DO NOTHING;

    INSERT INTO tbl_gst (zodu_id, branch_id, gst_rate)
    SELECT p_zodu_id, p_branch_id, v.gst_rate
    FROM (VALUES (5), (18), (40)) AS v(gst_rate)
    ON CONFLICT (zodu_id, branch_id, gst_rate) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
