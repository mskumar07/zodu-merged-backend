exports.parsePage = (page, limit) => {
  const parsedLimit  = Math.min(parseInt(limit, 10) || 10, 100);
  const parsedOffset = (Math.max(parseInt(page,  10) || 1, 1) - 1) * parsedLimit;
  return { limit: parsedLimit, offset: parsedOffset };
};

exports.buildMeta = (total, page, limit) => ({
  total,
  page:  +page  || 1,
  limit: +limit || 10,
  pages: Math.ceil(total / (limit || 10)),
});
