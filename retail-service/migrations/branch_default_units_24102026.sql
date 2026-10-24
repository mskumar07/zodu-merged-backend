-- Default units for a new branch, seeded entirely on the DB side. The unique
-- index makes the seed idempotent (ON CONFLICT DO NOTHING) and the function is
-- one set-based insert (no per-row round-trips from the app). Safe to re-run.
--
-- GST rates are NOT seeded per branch any more: tbl_gst is one common list
-- (see gst_common_table.sql).

CREATE UNIQUE INDEX IF NOT EXISTS uq_tbl_units_branch_name
    ON tbl_units (zodu_id, branch_id, name);

CREATE OR REPLACE FUNCTION seed_branch_defaults(p_zodu_id VARCHAR, p_branch_id VARCHAR)
RETURNS VOID AS $$
BEGIN
    INSERT INTO tbl_units (zodu_id, branch_id, name, short_name)
    SELECT p_zodu_id, p_branch_id, v.name, v.short_name
    FROM (VALUES
        ('Piece',  'PCS'),
        ('Box',    'BOX'),
        ('Litre',  'LTR'),
        ('Number', 'NOS'),
        ('Packet', 'PKT'),
        ('Set',    'SET'),
        ('Gram',   'GM'),
        ('Kilogram','KGS')
    ) AS v(name, short_name)
    ON CONFLICT (zodu_id, branch_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
