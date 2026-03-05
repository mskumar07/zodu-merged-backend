const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const isTaxInclusive = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

const calculateItemTax = (item) => {
  const qty = toNumber(item.qty);
  const price = toNumber(item.price); // MRP / unit price
  const gst = toNumber(item.tax); // GST %
  const taxInclusive = isTaxInclusive(item.tax_inclusive);

  const grossAmount = qty * price;

  let subtotal = 0; // tax-exclusive base
  let tax_amount = 0;

  if (taxInclusive && gst > 0) {
    // Remove included GST from MRP to get base subtotal
    subtotal = (grossAmount * 100) / (100 + gst);
    tax_amount = grossAmount - subtotal;
  } else {
    subtotal = grossAmount;
    tax_amount = (subtotal * gst) / 100;
  }

  const cgst_percentage = gst / 2;
  const sgst_percentage = gst / 2;
  const cgst = tax_amount / 2;
  const sgst = tax_amount / 2;

  return {
    gst_percentage: gst,
    cgst_percentage,
    sgst_percentage,
    tax_amount: round2(tax_amount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    subtotal: round2(subtotal),
    tax_inclusive: taxInclusive
  };
};

const getTaxFromItem = (item) => {
  const data = calculateItemTax(item);
  return {
    base: data.subtotal,
    tax: data.tax_amount,
    cgst: data.cgst,
    sgst: data.sgst,
    gst_percentage: data.gst_percentage,
    tax_inclusive: data.tax_inclusive
  };
};

module.exports = {
  calculateItemTax,
  getTaxFromItem
};
