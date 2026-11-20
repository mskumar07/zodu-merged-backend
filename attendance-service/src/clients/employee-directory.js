// Employees live in employee-service (its tbl_employees); this service keeps no copy.
// The branch roster is read from employee-service's internal API
//   GET /internal/employees/roster?zodu_id=&branch_id=      (caller name: attendance, INTERNAL_TOKEN)
// and handed to the SQL as a JSON parameter (see utils/sql.js EMPLOYEES_CTE), so the attendance /
// leave / dashboard queries keep their joins, search and paging without a local employee table.
//
// Cost control, since this sits in front of almost every request:
//  · a roster is cached per branch for TTL_MS; concurrent requests for the same branch share one call;
//  · the JSON text and the user_id index are built once per fetch, not once per query;
//  · if employee-service fails, the last roster (up to STALE_MS old) is served instead of failing the screen.

const axios = require('axios');
const { createInternalHttp } = require('@zodu/security');
const { EMPLOYEE_SERVICE_URL } = require('../config');
const { httpError } = require('../utils/http-error');
const { logger } = require('../utils/logger');

const TTL_MS = Number(process.env.EMPLOYEE_ROSTER_TTL_MS ?? 5000);
const STALE_MS = Number(process.env.EMPLOYEE_ROSTER_STALE_MS ?? 5 * 60_000);
const MAX_CACHED = 500;

const http = createInternalHttp(axios, { baseURL: String(EMPLOYEE_SERVICE_URL).replace(/\/+$/, ''), timeout: 4000 });

// key → { at, entry: { rows, json, byUser } | null, pending: Promise | null }
const cache = new Map();

async function fetchRoster(zodu_id, branch_id) {
  const { data } = await http.get('/internal/employees/roster', { params: { zodu_id, branch_id } });
  // The queries filter on e.zodu_id / e.branch_id, so every row carries the scope it was asked for.
  const rows = (Array.isArray(data?.data) ? data.data : []).map((e) => ({ ...e, zodu_id, branch_id }));
  const byUser = new Map();
  for (const e of rows) if (e.user_id) byUser.set(e.user_id, e);
  return { rows, json: JSON.stringify(rows), byUser };
}

/** The branch's cached roster entry { rows, json, byUser }, fetched when missing or older than TTL_MS. */
async function load({ zodu_id, branch_id }) {
  const key = `${zodu_id}|${branch_id}`;
  const slot = cache.get(key);
  if (slot?.entry && Date.now() - slot.at < TTL_MS) return slot.entry;
  if (slot?.pending) return slot.pending;

  const pending = fetchRoster(zodu_id, branch_id).then(
    (entry) => {
      if (cache.size >= MAX_CACHED && !cache.has(key)) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), entry, pending: null });
      return entry;
    },
    (err) => {
      // employee-service is down or slow: keep working on the last roster rather than fail the screen.
      if (slot?.entry && Date.now() - slot.at < STALE_MS) {
        logger.warn({ err: err.message, zodu_id, branch_id }, '[employee-directory] roster refresh failed, serving the last one');
        cache.set(key, { at: slot.at, entry: slot.entry, pending: null });
        return slot.entry;
      }
      cache.delete(key);
      const e = httpError(503, 'Employee service unavailable, try again');
      e.cause = err;
      throw e;
    },
  );
  cache.set(key, { at: slot?.at ?? 0, entry: slot?.entry ?? null, pending });
  return pending;
}

/** The branch's employees: [{ employee_id, employee_code, user_id, name, status, reporting_manager_id, ... }]. */
const roster = async (tenant) => (await load(tenant)).rows;

/** The roster as the JSON text the queries take as a parameter (serialised once per fetch). */
const rosterJson = async (tenant) => (await load(tenant)).json;

/** The signed-in user's own employee record in a company / branch, or null. */
const findByUser = async (user_id, tenant) => (await load(tenant)).byUser.get(user_id) || null;

/** Warm the cache before a transaction, so no pooled connection waits on employee-service. */
const prefetch = (tenant) => load(tenant).then(() => undefined);

const clearCache = () => cache.clear();

module.exports = { roster, rosterJson, findByUser, prefetch, clearCache };
