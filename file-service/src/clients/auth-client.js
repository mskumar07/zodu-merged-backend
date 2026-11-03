// Asks auth-service whether a user may act in a company / branch, and with which
// module permissions. Answers are cached for ACCESS_CACHE_TTL_MS (60s): a removed
// user or revoked role takes effect within a minute.

const axios = require('axios');
const { UnavailableError } = require('../utils/error/errors');
const { logger } = require('../utils/logger');

const MAX_ENTRIES = 10_000;

function createAuthClient({ baseUrl, token, ttlMs, http = axios }) {
  const cache = new Map();

  async function fetchAccess({ userId, zoduId, branchId }) {
    try {
      const { data } = await http.get(`${baseUrl}/internal/user-branch-access`, {
        params: { user_id: userId, zodu_id: zoduId, ...(branchId && { branch_id: branchId }) },
        headers: { 'X-Internal-Token': token },
        timeout: 3000,
      });
      return data.data;
    } catch (err) {
      logger.error({ err: err.message, status: err.response?.status }, 'auth-service access check failed');
      throw UnavailableError('Access check unavailable, try again');
    }
  }

  // → { is_member, branch_exists, has_branch_access, is_admin, permissions: { [module_name]: {read, create, edit, delete} } }
  async function getAccess(q) {
    const key = `${q.userId}|${q.zoduId}|${q.branchId || ''}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const value = await fetchAccess(q);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);   // oldest first
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  return { getAccess, clear: () => cache.clear() };
}

module.exports = { createAuthClient };
