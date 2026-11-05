// Return / note numbers from the document they are against (src/utils/generateId.js).
const { nextReturnId } = require('../src/utils/generateId');

// A pg client stand-in: answers the lookup from `existing` and records the query.
function fakeClient(existing) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const [zoduId, branchId, base, excludeUuid] = params;
      const rows = existing
        .filter((r) => r.zodu_id === zoduId && r.branch_id === branchId && r.return_uuid !== excludeUuid)
        .filter((r) => r.return_id === base || r.return_id.startsWith(`${base}-`))
        .map(({ return_id }) => ({ return_id }));
      return { rows };
    },
  };
}

const at = { zoduId: 'Z001', branchId: 'B1' };

test('prefix per type: RET for returns, CN for credit notes, DN for debit notes', async () => {
  const c = fakeClient([]);
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: 'INV-B1-0156' })).toBe('RET/INV-B1-0156');
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'CREDIT_NOTE', docId: 'INV-B1-0156' })).toBe('CN/INV-B1-0156');
  expect(await nextReturnId(c, { ...at, kind: 'purchase', returnType: 'PURCHASE_RETURN', docId: 'PUR-B1-035' })).toBe('RET/PUR-B1-035');
  expect(await nextReturnId(c, { ...at, kind: 'purchase', returnType: 'DEBIT_NOTE', docId: 'PUR-B1-035' })).toBe('DN/PUR-B1-035');
  expect(c.calls[0].sql).toMatch(/FROM tbl_sale_returns/);
  expect(c.calls[2].sql).toMatch(/FROM tbl_purchase_returns/);
});

test('a second one against the same document gets -2, then -3', async () => {
  const c = fakeClient([
    { zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'u1', return_id: 'RET/INV-B1-0156' },
    { zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'u2', return_id: 'RET/INV-B1-0156-2' },
  ]);
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: 'INV-B1-0156' })).toBe('RET/INV-B1-0156-3');
  // A credit note on the same invoice has its own sequence.
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'CREDIT_NOTE', docId: 'INV-B1-0156' })).toBe('CN/INV-B1-0156');
});

test('a gap is filled; another invoice whose id starts the same does not count', async () => {
  const c = fakeClient([
    { zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'u1', return_id: 'RET/INV-B1-0156' },
    { zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'u3', return_id: 'RET/INV-B1-0156-3' },
    { zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'u9', return_id: 'RET/INV-B1-01567' },
  ]);
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: 'INV-B1-0156' })).toBe('RET/INV-B1-0156-2');
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: 'INV-B1-0157' })).toBe('RET/INV-B1-0157');
});

test('numbers are per company and branch', async () => {
  const c = fakeClient([{ zodu_id: 'Z002', branch_id: 'B1', return_uuid: 'u1', return_id: 'RET/INV-B1-0001' }]);
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: 'INV-B1-0001' })).toBe('RET/INV-B1-0001');
  expect(c.calls[0].params.slice(0, 2)).toEqual(['Z001', 'B1']);
});

test('custom invoice numbers with slashes are kept as they are', async () => {
  const c = fakeClient([]);
  expect(await nextReturnId(c, { ...at, kind: 'sale', returnType: 'CREDIT_NOTE', docId: 'MA/2293/26-27' })).toBe('CN/MA/2293/26-27');
});

test('renumbering on a type change ignores the return itself', async () => {
  const c = fakeClient([{ zodu_id: 'Z001', branch_id: 'B1', return_uuid: 'self', return_id: 'DN/PUR-B1-035' }]);
  expect(await nextReturnId(c, { ...at, kind: 'purchase', returnType: 'DEBIT_NOTE', docId: 'PUR-B1-035', excludeUuid: 'self' })).toBe('DN/PUR-B1-035');
});

test('unknown type or missing document id is refused', async () => {
  const c = fakeClient([]);
  await expect(nextReturnId(c, { ...at, kind: 'sale', returnType: 'REFUND', docId: 'INV-1' })).rejects.toThrow(/Unknown/);
  await expect(nextReturnId(c, { ...at, kind: 'sale', returnType: 'SALES_RETURN', docId: null })).rejects.toThrow(/document/);
});
