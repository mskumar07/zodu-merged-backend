const { round } = require("./number");

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

// Money is kept to 2 decimals, exactly as the POS screen shows it: every line's
// taxable value and tax is rounded to paise first and the invoice totals are the
// sums of those rounded lines, so a printed invoice always adds up.
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const isTaxInclusive = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

// Mirrors the POS: a tax-inclusive price has its GST taken out, the unrounded
// line value (`rawBase`) feeds the tax and the discount shares, and the rounded
// value (`base`) is what is displayed and summed.
const calculateItemTax = (item) => {
  const qty = toNumber(item.quantity);
  const price = toNumber(item.price);
  const gst = toNumber(item.gst_percentage);
  const taxInclusive = isTaxInclusive(item.tax_inclusive);

  const unitPrice = taxInclusive && gst > 0 ? price / (1 + gst / 100) : price;
  const rawBase = qty * unitPrice;
  const tax_amount = round2((rawBase * gst) / 100);
  const cgst = round2(tax_amount / 2);

  return {
    gst_percentage: gst,
    tax_amount,
    cgst,
    sgst: round2(tax_amount - cgst),     // cgst + sgst always equals the line tax
    base: round2(rawBase),
    rawBase,
    tax_inclusive: taxInclusive
  };
};

const getTaxFromItem = (item) => {
  const data = calculateItemTax(item);
  return {
    base: data.base,
    tax: data.tax_amount,
    cgst: data.cgst,
    sgst: data.sgst,
    gst_percentage: data.gst_percentage,
    tax_inclusive: data.tax_inclusive
  };
};

// Order-level discount, as the POS takes it: a percentage is read off the
// taxable value ("before" GST) or off the GST-inclusive total ("after" GST);
// otherwise the flat value is used.
function priceOrder(items, discount_type, discount_value, gst_mode) {
  const lines = items.map(calculateItemTax);
  const beforeGst = gst_mode === "before";

  const subtotal = lines.reduce((sum, l) => sum + l.base, 0);
  const grossTax = lines.reduce((sum, l) => sum + l.tax_amount, 0);

  const discount_amount = discount_type === "percentage"
    ? ((beforeGst ? subtotal : subtotal + grossTax) * toNumber(discount_value)) / 100
    : toNumber(discount_value);

  // "Before GST": GST is recomputed on each line's share of the discounted base.
  // "After GST": the discount is a rebate on the final total; line tax is untouched.
  const taxes = beforeGst
    ? lines.map((l) => {
        const share = subtotal > 0 ? discount_amount * (l.rawBase / subtotal) : 0;
        const tax_amount = round2((Math.max(0, l.rawBase - share) * l.gst_percentage) / 100);
        const cgst = round2(tax_amount / 2);
        return { tax_amount, cgst, sgst: round2(tax_amount - cgst) };
      })
    : lines;

  return {
    lines,
    taxes,
    subtotal,
    discount_amount,
    total_tax: taxes.reduce((sum, t) => sum + t.tax_amount, 0),
  };
}

function calculateOrderTotals(
  items,
  discount_type,
  discount_value,
  gst_mode = "after"
) {
  const { subtotal, discount_amount, total_tax } =
    priceOrder(items, discount_type, discount_value, gst_mode);

  // Per-item discounts (tbl_sale_items.discount), summed separately from the
  // order-level discount and subtracted after it in both modes — same as the POS.
  const itemDiscountTotal = items.reduce((sum, item) => sum + toNumber(item.discount), 0);

  const total_amount = Math.max(
    0,
    gst_mode === "before"
      ? subtotal - discount_amount + total_tax - itemDiscountTotal
      : subtotal + total_tax - discount_amount - itemDiscountTotal
  );

  // POS round-off: to the nearest whole rupee.
  const rounded_total = Math.round(total_amount);
  const roundoff = Number((rounded_total - total_amount).toFixed(2));

  return {
    total_items: items.length,
    subtotal: round2(subtotal),
    discount_amount: round2(discount_amount),
    item_discount_total: itemDiscountTotal,
    total_tax: round2(total_tax),

    total_amount: total_amount, // before roundoff
    roundoff,
    final_amount: rounded_total // payable
  };
}

// Per-item tax figures that reflect the order-level discount ("before" GST
// re-computes each line's tax on its discounted base; "after" leaves it as is).
// Shares priceOrder with calculateOrderTotals, so the saved lines add up to the
// saved header.
function calculateItemsWithDiscount(items, discount_type, discount_value, gst_mode = "after") {
  const { lines, taxes } = priceOrder(items, discount_type, discount_value, gst_mode);

  return lines.map((line, i) => ({
    ...line,
    ...taxes[i],
  }));
}

module.exports = {
  calculateItemTax,
  getTaxFromItem,
  calculateOrderTotals,
  calculateItemsWithDiscount
};
