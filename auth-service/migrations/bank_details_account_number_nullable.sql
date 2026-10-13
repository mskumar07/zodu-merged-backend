-- Makes tbl_bank_details.account_number nullable.
--
-- Editing a branch's bank details with the account number left blank saves the
-- empty value as NULL (updateBranch in business-repo.js), which failed with a
-- NOT NULL violation. NULL means "no account number entered".
--
-- Run this once against the retail_auth_service database.
-- Safe to re-run: DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE tbl_bank_details
    ALTER COLUMN account_number DROP NOT NULL;
