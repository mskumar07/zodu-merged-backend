const axios = require('axios');
const { AUTH_SERVICE_URL } = require('../config');

const base = `${AUTH_SERVICE_URL}/internal`;

const client = axios.create({
  baseURL: base,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Extract data or throw a clean error from any auth-service response
async function call(fn) {
  try {
    const res = await fn();
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`auth-service: ${msg}`);
  }
}

// ── Company ───────────────────────────────────────────────────────────────────
exports.updateCompany = (zodu_id, data) =>
  call(() => client.put(`/company/${zodu_id}`, data));

exports.getCompany = (zodu_id) =>
  call(() => client.get(`/company/${zodu_id}`));

// ── Branch ────────────────────────────────────────────────────────────────────
exports.getBranches = (zodu_id) =>
  call(() => client.get(`/branches/${zodu_id}`));

exports.getBranch = (zodu_id, branch_id) =>
  call(() => client.get(`/branches/${zodu_id}/${branch_id}`));

exports.createDefaultBranch = (data) =>
  call(() => client.post('/branches/default', data));

exports.createBranch = (data) =>
  call(() => client.post('/branches', data));

exports.updateBranch = (zodu_id, branch_id, data) =>
  call(() => client.put(`/branches/${zodu_id}/${branch_id}`, data));

exports.findMaxBranchId = (zodu_id) =>
  call(() => client.get(`/branches/max/${zodu_id}`));

// ── Invoice Settings ──────────────────────────────────────────────────────────
exports.getInvoiceSettings = (zodu_id, branch_id) =>
  call(() => client.get(`/invoice-settings/${zodu_id}/${branch_id}`));
