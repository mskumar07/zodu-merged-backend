// Small helpers for building queries.

/** A search box's text as an ILIKE pattern ("%text%", with %, _ and \ made literal); null when empty. */
const likeOf = (search) => {
  const text = search ? String(search).trim() : '';
  return text ? `%${text.replace(/[\\%_]/g, '\\$&')}%` : null;
};

module.exports = { likeOf };
