const conn = require('../database/connection');
const authClient = require('../utils/authClient');

// Format: {invoice_prefix}-{branch_id}-{seq padded to 3 digits}
// e.g. "IXV-B1-144" — prefix comes from auth-service's tbl_invoice_settings,
// same convention as retail-service's generateSaleId. digit_count/start_number
// are fixed (Settings screen no longer exposes them): always 3 digits.
// The next number is derived from the highest existing public_order_no for
// this branch ACROSS ALL PREFIXES, so changing the prefix in Settings does
// not restart numbering — e.g. INV-B1-143 then switching to IXV produces
// IXV-B1-144, not IXV-B1-001. Falls back to 001 only when this branch has
// never had an order.
exports.generatePublicOrderNo = async (branch_id, zodu_id, client) => {
  const db = client ?? conn;
  const digitCount = 3;
  const startNumber = 1;

  let invoicePrefix = 'INV';
  try {
    const res = await authClient.getInvoiceSettings(zodu_id, branch_id);
    const settings = res?.data;
    if (settings?.invoice_prefix) {
      invoicePrefix = settings.invoice_prefix;
    }
  } catch (err) {
    console.error('[generatePublicOrderNo] invoice settings lookup failed, using defaults:', err.message);
  }

  // Transaction-scoped advisory lock so two concurrent orders for the same
  // branch can't read the same max and collide on the same number.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${zodu_id}:${branch_id}`]);

  const { rows } = await db.query(
    `SELECT public_order_no FROM tbl_orders
     WHERE zodu_id = $1 AND branch_id = $2 AND public_order_no LIKE $3
     ORDER BY (regexp_match(public_order_no, '-(\\d+)$'))[1]::int DESC
     LIMIT 1`,
    [zodu_id, branch_id, `%-${branch_id}-%`]
  );

  let nextNumber = startNumber;
  if (rows[0]) {
    const match = rows[0].public_order_no.match(/-(\d+)$/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  return `${invoicePrefix}-${branch_id}-${String(nextNumber).padStart(digitCount, '0')}`;
};
