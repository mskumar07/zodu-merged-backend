exports.getPagination = ({ page = 1, limit = 10 }) => {
  page = parseInt(page);
  limit = parseInt(limit);

  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
};

exports.getMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit)
});
