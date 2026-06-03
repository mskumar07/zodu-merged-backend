export const parseAttachments = (attachmentURL) => {
  if (!attachmentURL) return [];

  try {
    const data = JSON.parse(attachmentURL);
    // Ensure it's an array
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("❌ Invalid attachment_url format:", err);
    return [];
  }
}

export const calculateOrderSummary = (items) => {
  let subtotal = 0;
  let total_tax = 0;
  let total_quantity = 0;

  for (const item of items) {
    const qty = Number(item.qty);
    const price = Number(item.price);
    const gst = Number(item.gst_percentage ?? item.tax ?? 0);
    const taxInclusive = item.tax_inclusive === true;

    let base = 0;
    let tax = 0;

    if (taxInclusive) {
      const total = price * qty;
      base = (total * 100) / (100 + gst);
      tax = total - base;
    } else {
      base = price * qty;
      tax = (base * gst) / 100;
    }

    subtotal += base;
    total_tax += tax;
    total_quantity += qty;
  }

  return {
    subtotal,
    total_tax,
    total_quantity,
    no_of_items: items.length // ✅ FIXED
  };
};

export const calculateDiscount = (subtotal, type, value) => {
  const discountType = type ? type.toUpperCase() : null;
  let discount_amount = 0;

  if (discountType === "PERCENT") {
    discount_amount = (subtotal * Number(value || 0)) / 100;
  } else if (discountType === "FLAT") {
    discount_amount = Number(value || 0);
  }

  if (discount_amount > subtotal) discount_amount = subtotal;

  return { discountType, discount_amount };
};
