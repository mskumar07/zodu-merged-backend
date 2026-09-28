# What each product service needs to add

The admin backend never touches another service's database. It only calls
HTTP endpoints — the same `/internal` pattern `auth-service` already uses
for `restaurant-service` (see `auth-service/src/api/internal-controller.js`).

Two things every product service needs before the admin panel can use it:

## 0. Internal-key middleware (add once per service)

```js
// src/middleware/internalAuth.js
module.exports = (req, res, next) => {
  if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};
```

Apply it to the `/internal` router, or to a new `/internal/admin` sub-router
if you'd rather keep admin-only routes separate from the existing
service-to-service ones:

```js
app.use('/internal', require('./middleware/internalAuth'), require('./api/internal-controller'));
```

Set `INTERNAL_SERVICE_KEY` to the same value in every service's `.env` and
in `zodu_admin_panel_backend/.env` — it's one shared secret, like a simple
API key, not per-service.

**Never expose `/internal/*` through api-gateway.** It should only be
reachable on the internal Docker network.

## 1. auth-service — add to `internal-controller.js`

```js
// GET /internal/admin/companies?page=&limit=&search=
router.get('/admin/companies', async (req, res) => {
  const { page = 1, limit = 20, search = '' } = req.query;
  const result = await repo.listCompaniesPaged({ page, limit, search }); // add to business-repo.js
  res.json({ success: true, data: result.rows, total: result.total, page: Number(page), limit: Number(limit) });
});

// GET /internal/admin/subscriptions?page=&limit=&status=&sort=
router.get('/admin/subscriptions', async (req, res) => {
  const result = await repo.listSubscriptionsPaged(req.query); // add to business-repo.js, queries tbl_subscription
  res.json({ success: true, data: result.rows, total: result.total });
});

// PUT /internal/admin/subscriptions/:zodu_id/:branch_id
router.put('/admin/subscriptions/:zodu_id/:branch_id', async (req, res) => {
  const updated = await repo.updateSubscription(req.params.zodu_id, req.params.branch_id, req.body);
  res.json({ success: true, data: updated });
});
```

`listCompaniesPaged` is a straightforward `SELECT ... FROM tbl_business
LIMIT/OFFSET` with an optional `ILIKE` filter on `business_name`/`mail_id`;
`total` count query alongside it for pagination.

## 2. retail-service — add to `internal-controller.js`

```js
// GET /internal/admin/invoices/stats  -> { total, changePct }
// GET /internal/admin/purchases/stats -> { total, changePct }
// GET /internal/admin/expenses/stats  -> { total, changePct }
// GET /internal/admin/companies/stats?limit= -> [{ zodu_id, business_name, invoiceCount, purchaseCount, expenseCount }, ...]
```

`changePct` = (this month's count vs last month's count). Simple `COUNT(*)
... WHERE created_at >= date_trunc('month', now())` compared to the prior
month; no need for anything fancier at current scale.

## 3. employee-service (optional, later)

```js
// GET /internal/admin/users/stats -> { total, changePct }
```

## Why HTTP instead of a shared DB connection

- Keeps write-ownership of each table with the service that already
  understands its invariants (subscription state machine, invoice
  numbering, purge cascades, etc.) — the admin panel doesn't have to
  reimplement any of that.
- A schema change inside one service doesn't silently break the admin
  panel's queries; it breaks a documented HTTP contract instead, which is
  visible and versionable.
- Matches the pattern this codebase already uses between its own services
  (`internal-controller.js`, `branchPurgeClient.js`, `companyPurgeClient.js`).
