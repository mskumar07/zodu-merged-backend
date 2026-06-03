const repo = require("../repository/vendor-repo");

const normalizeVendorPayload = (data) => {
  if (Array.isArray(data)) {
    const [
      zodu_id,
      branch_id,
      company_name,
      vendor_name,
      gst,
      vendor_phone,
      vendor_email,
      vendor_address_1,
      vendor_address_2,
      city,
      state,
      pincode,
    ] = data;

    return {
      zodu_id,
      branch_id,
      company_name,
      vendor_name,
      gst,
      vendor_phone,
      vendor_email,
      vendor_address_1,
      vendor_address_2,
      city,
      state,
      pincode,
    };
  }

  return {
    ...data,
    vendor_address_1: data?.vendor_address_1 ?? data?.vendor_address ?? null,
    vendor_address_2: data?.vendor_address_2 ?? null,
  };
};

exports.createVendor = async (data) => {
  const vendor = await repo.createVendor(normalizeVendorPayload(data));
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
