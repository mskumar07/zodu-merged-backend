export function calculateItemTax(item) {
  const qty = Number(item.qty);
  const price = Number(item.price);
  const gst = Number(item.tax || 0); // GST %

  const subtotal = qty * price;

  const cgst_percentage = gst / 2;
  const sgst_percentage = gst / 2;

  const cgst = (subtotal * cgst_percentage) / 100;
  const sgst = (subtotal * sgst_percentage) / 100;

  const tax_amount = cgst + sgst; // total GST

  return {
    gst_percentage: gst,
    cgst_percentage,
    sgst_percentage,
    tax_amount,
    cgst,
    sgst,
    subtotal
  };
}
