const authClient = require('../utils/authClient');

// All branch/address/bank/business data lives in retail_auth_service DB.
// This repo delegates every operation to auth-service via HTTP (authClient).

exports.getBranches = async (zodu_id, branch_id = null) => {
  if (branch_id) {
    const res = await authClient.getBranch(zodu_id, branch_id);
    return res.data ? [res.data] : [];
  }
  const res = await authClient.getBranches(zodu_id);
  return res.data || [];
};

exports.getBranchByIds = async (zodu_id, branch_id) => {
  const res = await authClient.getBranch(zodu_id, branch_id);
  return res.data || null;
};

exports.createBranch = async (branchData) => {
  console.log("Creating branch with data:--------", branchData);
  const res = await authClient.createBranch(branchData);
  return res.data;
};

exports.updateBranch = async (zodu_id, branch_id, fields) => {
  const res = await authClient.updateBranch(zodu_id, branch_id, fields);
  return res.data;
};
