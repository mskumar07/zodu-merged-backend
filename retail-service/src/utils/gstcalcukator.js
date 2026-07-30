const { round } = require("./number");

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const round2 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;

const isTaxInclusive = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

const calculateItemTax = (item) => {
  const qty = toNumber(item.quantity);          // ✅ FIX
  const price = toNumber(item.price);
  const gst = toNumber(item.gst_percentage);    // ✅ FIX
  const taxInclusive = isTaxInclusive(item.tax_inclusive);

  const grossAmount = qty * price;

  let subtotal = 0;
  let tax_amount = 0;

  if (taxInclusive && gst > 0) {
    subtotal = (grossAmount * 100) / (100 + gst);
    tax_amount = grossAmount - subtotal;
  } else {
    subtotal = grossAmount;
    tax_amount = (subtotal * gst) / 100;
  }

  const cgst = tax_amount / 2;
  const sgst = tax_amount / 2;

  return {
    gst_percentage: gst,
    tax_amount: round2(tax_amount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    base: round2(subtotal),        // ✅ IMPORTANT rename
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



function calculateOrderTotals(
  items,
  discount_type,
  discount_value,
  gst_mode = "after"
) {
  let subtotal = 0;
  let total_tax = 0;

  const parsedItems = items.map((item) => {
    const taxData = calculateItemTax(item); // ✅ use your GST logic

    return {
      base: taxData.base,
      tax: taxData.tax_amount
    };
  });

  subtotal = parsedItems.reduce((sum, i) => sum + i.base, 0);

  // Per-item discounts (tbl_sale_items.discount), summed separately from the
  // order-level discount — matches the frontend's itemDiscountTotal, which is
  // subtracted from grandTotalRaw after the order-level discount in both modes.
  const itemDiscountTotal = items.reduce((sum, item) => sum + toNumber(item.discount), 0);

  let discount_amount = 0;
  let total_amount = 0;
  console.log("gst_mode", gst_mode, "discount_type", discount_type, "discount_value", discount_value);
  // 🔥 BEFORE GST
  if (gst_mode === "before") {
    if (discount_type === "percentage") {
      discount_amount = (subtotal * discount_value) / 100;
    } else {
      discount_amount = Number(discount_value || 0);
    }

    const discountedSubtotal = subtotal - discount_amount;

    total_tax = parsedItems.reduce((sum, i) => {
      const ratio = i.base / subtotal || 0;
      const newBase = discountedSubtotal * ratio;
      return sum + (newBase * (i.tax / i.base || 0));
    }, 0);

    total_amount = discountedSubtotal + total_tax - itemDiscountTotal;
  } else {
    // 🔥 AFTER GST
    total_tax = parsedItems.reduce((sum, i) => sum + i.tax, 0);
    console.log("subtotal", subtotal, "total_tax", total_tax, "discount_type", discount_type, "discount_value", discount_value);
    const gross = subtotal + total_tax;

    if (discount_type === "percentage") {
      discount_amount = (gross * discount_value) / 100;
    } else {
      discount_amount = Number(discount_value || 0);
    }

    console.log("gross", gross, "discount_amount", discount_amount);
    total_amount = gross - discount_amount - itemDiscountTotal;
  }

  // =====================================================
  // 🔥 POS ROUNDOFF — round to nearest whole rupee, matching frontend
  // =====================================================
  const rounded_total = Math.round(total_amount);
  const roundoff = Number((rounded_total - total_amount).toFixed(2));
  console.log("total_amount", total_amount, "rounded_total", rounded_total, "roundoff", roundoff);

  return {
    total_items: items.length,
    subtotal: subtotal,
    discount_amount: discount_amount,
    item_discount_total: itemDiscountTotal,
    total_tax: total_tax,

    total_amount: total_amount, // before roundoff
    roundoff,
    final_amount: rounded_total
           // payable
  };
}

// Per-item tax figures that reflect the order-level discount, mirroring the
// redistribution calculateOrderTotals does for "before" GST mode. "after" mode
// leaves item tax untouched since that discount is a final-total rebate, not
// a tax adjustment — matches calculateOrderTotals's own math exactly.
function calculateItemsWithDiscount(items, discount_type, discount_value, gst_mode = "after") {
  const parsedItems = items.map((item) => ({ item, taxData: calculateItemTax(item) }));
  const subtotal = parsedItems.reduce((sum, i) => sum + i.taxData.base, 0);

  if (gst_mode !== "before" || subtotal === 0) {
    return parsedItems.map(({ taxData }) => taxData);
  }

  const discount_amount = discount_type === "percentage"
    ? (subtotal * toNumber(discount_value)) / 100
    : toNumber(discount_value);
  const discountedSubtotal = subtotal - discount_amount;

  return parsedItems.map(({ taxData }) => {
    const ratio = taxData.base / subtotal || 0;
    const newBase = discountedSubtotal * ratio;
    const tax_amount = (newBase * taxData.gst_percentage) / 100;

    return {
      ...taxData,
      base: round2(newBase),
      tax_amount: round2(tax_amount),
      cgst: round2(tax_amount / 2),
      sgst: round2(tax_amount / 2),
    };
  });
}

module.exports = {
  calculateItemTax,
  getTaxFromItem,
  calculateOrderTotals,
  calculateItemsWithDiscount
};
