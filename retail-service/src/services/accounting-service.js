const repo = require("../repository/accounting-repo");
const { getPagination, getMeta } = require("../utils/pagination");

const TYPES = [
  "Sales", "Payment", "Purchase", "Expense", "Receipt",
  "Sales Return", "Purchase Return", "Credit Note", "Debit Note",
];

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const n = (v) => parseFloat(v) || 0;

// "Sales,Receipt" → ["Sales", "Receipt"]; matched case-insensitively against the known types.
function parseTypes(type) {
  if (!type) return null;
  const wanted = String(type).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const types = wanted.map((w) => TYPES.find((t) => t.toLowerCase() === w));
  if (types.includes(undefined)) throw badRequest(`type must be one of: ${TYPES.join(", ")}`);
  return types;
}

function parseDates(from_date, to_date) {
  if ((from_date && !isDate(from_date)) || (to_date && !isDate(to_date))) {
    throw badRequest("from_date/to_date must be YYYY-MM-DD");
  }
  return { from_date: from_date || null, to_date: to_date || null };
}

exports.getAccounting = async (zodu_id, branch_id, { from_date, to_date, type, search, page, limit }) => {
  const dates = parseDates(from_date, to_date);
  const types = parseTypes(type);
  const { page: rawPage, limit: rawLimit } = getPagination({ page, limit });
  const pg  = Math.max(rawPage || 1, 1);
  const lmt = Math.min(Math.max(rawLimit || 20, 1), 200);
  const offset = (pg - 1) * lmt;
  const searchFilter = search && search.trim() ? search.trim() : null;

  const [{ total, rows }, summary] = await Promise.all([
    repo.getAccountingEntries(zodu_id, branch_id, { ...dates, types, search: searchFilter }, lmt, offset),
    repo.getAccountingSummary(zodu_id, branch_id, dates),
  ]);

  const bucket = (kind) => ({ amount: n(summary[`${kind}_amount`]), count: parseInt(summary[`${kind}_count`], 10) || 0 });

  return {
    summary: {
      sales:     bucket("sales"),
      purchases: bucket("purchases"),
      payments:  bucket("payments"),
      receipts:  bucket("receipts"),
      expenses:  bucket("expenses"),
    },
    data: rows.map((r) => {
      const balance = n(r.balance);
      return {
        id:           r.id,
        date_time:    r.date_time,
        type:         r.type,
        reference:    r.reference,
        party:        r.party,
        payment_type: r.payment_type,
        debit:        r.debit === null ? null : n(r.debit),
        credit:       r.credit === null ? null : n(r.credit),
        balance:      Math.abs(balance),
        balance_side: balance >= 0 ? "Cr" : "Dr",
      };
    }),
    meta: getMeta({ page: pg, limit: lmt, total }),
  };
};
