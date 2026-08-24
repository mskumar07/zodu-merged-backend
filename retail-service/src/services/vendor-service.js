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
  try {
    const vendor = await repo.createVendor(normalizeVendorPayload(data));
    return { success: true, data: vendor };
  } catch (err) {
    if (
      err.message === "Vendor phone number already exists" ||
      err.message === "Vendor email already exists"
    ) {
      return { success: false, message: err.message };
    }
    throw err;
  }
};

exports.getVendors = async (params) => {
  const data = await repo.getVendors(params);
  return { success: true, data };
};

exports.getVendorById = async (id) => {
  const vendor = await repo.getVendorById(id);
  if (!vendor) {
    return { success: false, message: "Vendor not found" };
  }
  return { success: true, data: vendor };
};

exports.updateVendor = async (id, data) => {
  try {
    const updated = await repo.updateVendor(id, data);
    return { success: true, data: updated };
  } catch (err) {
    if (
      err.message === "Vendor phone number already exists" ||
      err.message === "Vendor email already exists" ||
      err.message === "Vendor not found"
    ) {
      return { success: false, message: err.message };
    }
    throw err;
  }
};

exports.deleteVendor = async (id) => {
  await repo.deleteVendor(id);
  return { success: true };
};
