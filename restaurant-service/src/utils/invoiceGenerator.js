async function generateInvoiceNo(client, branch_id, sale_date) {
  const dateObj = sale_date ? new Date(sale_date) : new Date();
  const datePart = dateObj.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
 
  // Lock the latest invoice for this branch+date inside the transaction
  const { rows } = await client.query(
    `SELECT invoice_no
     FROM tbl_sales
     WHERE branch_id = $1
       AND sale_date = $2
     ORDER BY invoice_no DESC
     LIMIT 1
     FOR UPDATE`,
    [branch_id, sale_date || new Date().toISOString().slice(0, 10)]
  );
 
  let nextSeq = 1;
 
  if (rows.length > 0) {
    // Parse the last sequence number from the invoice string
    const lastInvoice = rows[0].invoice_no; // e.g. INV-20260315-BR001-0042
    const parts = lastInvoice.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }
 
  const seqPart = String(nextSeq).padStart(4, '0');
  return `INV-${datePart}-${branch_id}-${seqPart}`;
}
 
module.exports = { generateInvoiceNo };
 