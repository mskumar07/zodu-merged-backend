-- tbl_kot_list.status used the word 'Pending' (the column default). It is now
-- a one-letter item state: 'P' = Pending (default), 'C' = Completed. 'C' is
-- set by PUT /api/kot/item-ready from the KDS item modal; the row stays on the
-- KOT card (struck through) until the whole order is marked ready.
--
-- Run this once against the service's database.
-- Safe to re-run: SET DEFAULT is idempotent and the UPDATE matches nothing
-- once the rows are converted.

ALTER TABLE tbl_kot_list
    ALTER COLUMN status SET DEFAULT 'P';

UPDATE tbl_kot_list
SET status = 'P'
WHERE status = 'Pending';
