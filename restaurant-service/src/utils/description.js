// Item descriptions are optional, so the menu / sale / sale-return GET
// responses carry `description` only when the row actually has one — an item
// without a description has no key at all, rather than a null the frontend
// has to filter out before rendering the invoice line.
//
// Accepts a single row, an array of rows, or null/undefined, and returns the
// same shape it was given.
const withDescription = (row) => {
  if (Array.isArray(row)) return row.map(withDescription);
  if (!row || typeof row !== "object") return row;

  const { description } = row;
  if (description === null || description === undefined || String(description).trim() === "") {
    const { description: _empty, ...rest } = row;
    return rest;
  }

  return row;
};

// Writers accept either key: the item screens send `description`, the billing
// screens send `item_description`. Both land in the same column.
const pickDescription = (item) =>
  item?.description ?? item?.item_description ?? null;

module.exports = { withDescription, pickDescription };
