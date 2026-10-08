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

// ── Branch / Company ──────────────────────────────────────────────────────────
exports.getBranch = (zodu_id, branch_id) =>
  call(() => client.get(`/branches/${zodu_id}/${branch_id}`));

exports.getCompany = (zodu_id) =>
  call(() => client.get(`/company/${zodu_id}`));

// ── Invoice Settings ──────────────────────────────────────────────────────────
exports.getInvoiceSettings = (zodu_id, branch_id) =>
  call(() => client.get(`/invoice-settings/${zodu_id}/${branch_id}`));

exports.upsertInvoiceSettings = (zodu_id, branch_id, data) =>
  call(() => client.put(`/invoice-settings/${zodu_id}/${branch_id}`, data));

// ── POS Settings ──────────────────────────────────────────────────────────────
// Used for quotation_prefix/proforma_prefix (see generateSaleId).
exports.getPosSettings = (zodu_id, branch_id) =>
  call(() => client.get(`/pos-settings/${zodu_id}/${branch_id}`));
