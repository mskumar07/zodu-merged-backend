-- Seeds tbl_doc_id_seq's 'ORD' counter from existing tbl_orders rows so the
-- switch to atomic sequence-based public_order_no generation (see
-- src/repository/generatePublicOrderNo.js) doesn't restart numbering at 1 and
-- collide with already-issued order numbers on tbl_orders'
-- uq_orders_branch_public_no constraint. Idempotent — GREATEST keeps
-- whichever is higher on re-run.
--
-- Every existing public_order_no observed ends in a run of digits regardless
-- of prefix format (INVQ-B1-018, Z072-B1-0001, B1-1009, ...), so the trailing
-- digit run is taken as the sequence value regardless of what precedes it.
INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
SELECT
  zodu_id,
  branch_id,
  'ORD' AS doc_type,
  MAX((regexp_match(public_order_no, '(\d+)$'))[1]::int) AS last_seq
FROM tbl_orders
WHERE public_order_no ~ '(\d+)$'
GROUP BY zodu_id, branch_id
ON CONFLICT (zodu_id, branch_id, doc_type)
DO UPDATE SET last_seq = GREATEST(tbl_doc_id_seq.last_seq, EXCLUDED.last_seq);
