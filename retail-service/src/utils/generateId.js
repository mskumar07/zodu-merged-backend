// Return / note numbers, taken from the document they are against:
//
//   Sales Return      RET/<invoice id>       e.g. RET/INV-B1-0156
//   Purchase Return   RET/<purchase id>      e.g. RET/PUR-B1-035
//   Credit Note       CN/<invoice id>        e.g. CN/INV-B1-0156
//   Debit Note        DN/<purchase id>       e.g. DN/PUR-B1-035
//
// A second one of the same kind against the same document gets -2, then -3, ...
// (RET/INV-B1-0156-2). Unique per company and branch, like the tables' indexes.
// The caller holds the original sale / purchase row locked (FOR UPDATE), so two
// returns against one document can't be given the same number.

const PREFIX = {
  SALES_RETURN: 'RET',
  PURCHASE_RETURN: 'RET',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

const TABLE = {
  sale: 'tbl_sale_returns',
  purchase: 'tbl_purchase_returns',
};

/**
 * @param client     pg client inside the caller's transaction
 * @param kind       'sale' | 'purchase'
 * @param returnType SALES_RETURN | CREDIT_NOTE | PURCHASE_RETURN | DEBIT_NOTE
 * @param docId      the invoice id (sale_id) or purchase_id
 * @param excludeUuid a return being renumbered (its own number doesn't count)
 */
async function nextReturnId(client, { kind, returnType, docId, zoduId, branchId, excludeUuid = null }) {
  const prefix = PREFIX[returnType];
  const table = TABLE[kind];
  if (!prefix || !table) throw new Error(`Unknown return kind/type: ${kind}/${returnType}`);
  if (!docId) throw new Error('A return needs the id of the document it is against');

  const base = `${prefix}/${docId}`;
  const { rows } = await client.query(
    `SELECT return_id FROM ${table}
      WHERE zodu_id = $1 AND branch_id = $2
        AND (return_id = $3 OR left(return_id, length($3) + 1) = $3 || '-')
        AND ($4::uuid IS NULL OR return_uuid <> $4::uuid)`,
    [zoduId, branchId, base, excludeUuid]
  );
  const taken = new Set(rows.map((r) => r.return_id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// The prefix a type's number starts with (RET / CN / DN).
const returnIdPrefix = (returnType) => PREFIX[returnType] ?? null;

module.exports = {
  nextReturnId,
  returnIdPrefix,
};
