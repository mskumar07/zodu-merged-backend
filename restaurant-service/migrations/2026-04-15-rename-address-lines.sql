ALTER TABLE tbl_address
  RENAME COLUMN floor_building_no TO address_line_1;

ALTER TABLE tbl_address
  RENAME COLUMN area_street_name TO address_line_2;
