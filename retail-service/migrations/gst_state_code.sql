-- GST state code master: the 2-digit code that prefixes every GSTIN and
-- decides place of supply (intra-state CGST+SGST vs inter-state IGST).
-- Global reference data — not tenant scoped (no zodu_id / branch_id).
--
--   state_code  -- '33', the GSTIN prefix
--   state_name  -- 'Tamil Nadu'
--   short_code  -- 'TN'
--   state_type  -- 'State' | 'UT' (UTs without a legislature charge UTGST)
--
-- Run this once against the service's database.
-- Safe to re-run: CREATE IF NOT EXISTS + upsert on state_code.

CREATE TABLE IF NOT EXISTS tbl_gst_state_code (
    id          SERIAL PRIMARY KEY,
    state_code  VARCHAR(2)   NOT NULL UNIQUE,
    state_name  VARCHAR(100) NOT NULL,
    short_code  VARCHAR(5),
    state_type  VARCHAR(10)  NOT NULL DEFAULT 'State',
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO tbl_gst_state_code (state_code, state_name, short_code, state_type) VALUES
    ('01', 'Jammu and Kashmir',                        'JK', 'UT'),
    ('02', 'Himachal Pradesh',                         'HP', 'State'),
    ('03', 'Punjab',                                   'PB', 'State'),
    ('04', 'Chandigarh',                               'CH', 'UT'),
    ('05', 'Uttarakhand',                              'UK', 'State'),
    ('06', 'Haryana',                                  'HR', 'State'),
    ('07', 'Delhi',                                    'DL', 'UT'),
    ('08', 'Rajasthan',                                'RJ', 'State'),
    ('09', 'Uttar Pradesh',                            'UP', 'State'),
    ('10', 'Bihar',                                    'BR', 'State'),
    ('11', 'Sikkim',                                   'SK', 'State'),
    ('12', 'Arunachal Pradesh',                        'AR', 'State'),
    ('13', 'Nagaland',                                 'NL', 'State'),
    ('14', 'Manipur',                                  'MN', 'State'),
    ('15', 'Mizoram',                                  'MZ', 'State'),
    ('16', 'Tripura',                                  'TR', 'State'),
    ('17', 'Meghalaya',                                'ML', 'State'),
    ('18', 'Assam',                                    'AS', 'State'),
    ('19', 'West Bengal',                              'WB', 'State'),
    ('20', 'Jharkhand',                                'JH', 'State'),
    ('21', 'Odisha',                                   'OD', 'State'),
    ('22', 'Chhattisgarh',                             'CG', 'State'),
    ('23', 'Madhya Pradesh',                           'MP', 'State'),
    ('24', 'Gujarat',                                  'GJ', 'State'),
    ('26', 'Dadra and Nagar Haveli and Daman and Diu', 'DN', 'UT'),
    ('27', 'Maharashtra',                              'MH', 'State'),
    ('29', 'Karnataka',                                'KA', 'State'),
    ('30', 'Goa',                                      'GA', 'State'),
    ('31', 'Lakshadweep',                              'LD', 'UT'),
    ('32', 'Kerala',                                   'KL', 'State'),
    ('33', 'Tamil Nadu',                               'TN', 'State'),
    ('34', 'Puducherry',                               'PY', 'UT'),
    ('35', 'Andaman and Nicobar Islands',              'AN', 'UT'),
    ('36', 'Telangana',                                'TS', 'State'),
    ('37', 'Andhra Pradesh',                           'AD', 'State'),
    ('38', 'Ladakh',                                   'LA', 'UT'),
    ('96', 'Other Country',                            'OC', 'Other'),
    ('97', 'Other Territory',                          'OT', 'Other')
ON CONFLICT (state_code) DO UPDATE
    SET state_name = EXCLUDED.state_name,
        short_code = EXCLUDED.short_code,
        state_type = EXCLUDED.state_type,
        updated_at = NOW();
