const repo = require("../repository/vendor-repo");

exports.createVendor = async (data) => {
  const vendor = await repo.createVendor(data);
  return { success: true, data: vendor };
};

exports.getVendors = async (params) => {
  const data = await repo.getVendors(params);
  return { success: true, data };
};

exports.updateVendor = async (id, data) => {
  const updated = await repo.updateVendor(id, data);
  return { success: true, data: updated };
};

exports.deleteVendor = async (id) => {
  await repo.deleteVendor(id);
  return { success: true };
};