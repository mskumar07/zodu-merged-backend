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


export function getTaxFromItem(item) {
  const qty = Number(item.qty);
  const price = Number(item.price);
  const gst = Number(item.tax || 0);

  const taxInclusive =
    item.tax_inclusive === true ||
    item.tax_inclusive === "true" ||
    item.tax_inclusive === 1 ||
    item.tax_inclusive === "1";

  let base = 0;
  let tax = 0;

  if (taxInclusive) {
    const totalWithTax = price * qty;
    base = (totalWithTax * 100) / (100 + gst);
    tax = totalWithTax - base;
  } else {
    base = price * qty;
    tax = (base * gst) / 100;
  }

  return {
    base,
    tax,
    cgst: tax / 2,
    sgst: tax / 2,
    gst_percentage: gst,
    tax_inclusive: taxInclusive
  };
}