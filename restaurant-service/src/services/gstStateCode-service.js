const repo = require("../repository/gstStateCode-repo");

// Accepts '33', '3', or a full GSTIN ('33ABCDE1234F1Z5') — the state code is
// always the first two digits of a GSTIN.
const normalizeStateCode = (value) => {
  const str = String(value ?? "").trim();
  if (/^\d{1,2}$/.test(str)) return str.padStart(2, "0");
  if (/^\d{2}[A-Z0-9]{13}$/i.test(str)) return str.slice(0, 2);
  return null;
};

exports.getStateCodes = async (params) => {
  const data = await repo.getStateCodes(params);
  return { success: true, data };
};

exports.getByStateCode = async (value) => {
  const state_code = normalizeStateCode(value);
  if (!state_code) {
    return { success: false, message: "Invalid state code or GSTIN" };
  }

  const data = await repo.getByStateCode(state_code);
  if (!data) {
    return { success: false, message: "State code not found" };
  }
  return { success: true, data };
};
