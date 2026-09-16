const conn = require('../database/connection');
const authClient = require('../utils/authClient');

// Settings-driven prefix (tbl_invoice_settings.invoice_prefix /
// invoice_prefix_enabled — same convention as retail-service's
// generateSaleId) plus an atomically-incremented counter from the shared
// tbl_doc_id_seq table (doc_type 'ORD', same table purchase/expense ids
// already use), scoped per (zodu_id, branch_id). No branch_id in the
// generated text — the counter is already scoped per branch, so spelling it
// out in the id text is redundant (matches retail-service's sale_id format).
//
// Replaces the old LIKE-query-against-tbl_orders + advisory-lock approach:
// that lock was taken via conn.query() outside any real transaction, so it
// never actually serialized concurrent inserts — tbl_orders.public_order_no
// has duplicate values from before this fix as a result. tbl_doc_id_seq's
// own primary key (zodu_id, branch_id, doc_type) makes the INSERT ... ON
// CONFLICT below atomic on its own, with no lock needed.
exports.generatePublicOrderNo = async (branch_id, zodu_id, client) => {
  const db = client ?? conn;

  let invoicePrefix = 'INV';
  try {
    const res = await authClient.getInvoiceSettings(zodu_id, branch_id);
    const settings = res?.data;
    // Toggled off means the branch wants no prefix at all — takes priority
    // over whatever text is saved in invoice_prefix. Missing/true (including
    // rows from before this column existed) keeps today's always-on behavior.
    if (settings?.invoice_prefix_enabled === false) {
      invoicePrefix = '';
    } else if (settings?.invoice_prefix) {
      invoicePrefix = settings.invoice_prefix;
    }
  } catch (err) {
    console.error('[generatePublicOrderNo] invoice settings lookup failed, using defaults:', err.message);
  }

  const { rows } = await db.query(
    `INSERT INTO tbl_doc_id_seq (zodu_id, branch_id, doc_type, last_seq)
     VALUES ($1, $2, 'ORD', 1)
     ON CONFLICT (zodu_id, branch_id, doc_type)
     DO UPDATE SET last_seq = tbl_doc_id_seq.last_seq + 1
     RETURNING last_seq`,
    [zodu_id, branch_id]
  );
  const nextNumber = rows[0].last_seq;
  const padded = String(nextNumber).padStart(3, '0');

  return invoicePrefix ? `${invoicePrefix}-${padded}` : padded;
};
