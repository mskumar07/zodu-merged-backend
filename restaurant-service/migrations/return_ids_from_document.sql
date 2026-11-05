-- Purchase return / debit note numbers now come from the purchase they are
-- against (RET/<purchase id>, DN/<purchase id>, then -2, -3 ...; utils/generateId.js):
-- room for the prefix and suffix on top of a 50-character purchase_id.
-- Existing returns keep their old PRT-... numbers. Idempotent.

ALTER TABLE tbl_purchase_returns ALTER COLUMN return_id TYPE VARCHAR(80);
