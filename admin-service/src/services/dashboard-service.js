const { authService, retailService } = require('../clients');
const { logger } = require('../utils/logger');

// Fans out to every relevant microservice in parallel and composes one
// dashboard payload. Uses allSettled, not all — one service being down
// (e.g. payroll-service deploying) must not blank the whole dashboard, it
// should just zero that one card. This is the "on-demand fan-out with
// graceful degradation" approach: fine at current scale, and the natural
// place to swap in a cached read-model (CQRS) later if these calls get
// slow — see admin backend README §"Scaling the dashboard".
function settle(result, fallback) {
  if (result.status === 'fulfilled') return result.value;
  logger.warn({ err: result.reason?.message }, 'dashboard: one upstream failed, using fallback');
  return fallback;
}

// retail-service only knows zodu_id (business_name lives in auth-service's
// own database — no cross-database JOIN is possible), so the "Company /
// User-wise Statistics" table is composed here: auth-service supplies the
// name/contact fields, retail-service supplies the counts, joined on
// zodu_id in application code. limit is generous relative to
// getCompanyWiseStats' top-10 so every zodu_id it returns has a matching
// company row to join against.
function attachCompanyNames(companyStats, companies) {
  const byZoduId = new Map(companies.map((c) => [c.zodu_id, c]));
  return companyStats.map((stat) => {
    const company = byZoduId.get(stat.zodu_id);
    return {
      zodu_id: stat.zodu_id,
      business_name: company?.business_name || stat.zodu_id,
      invoiceCount: stat.invoice_count,
      purchaseCount: stat.purchase_count,
      expenseCount: stat.expense_count,
    };
  });
}

exports.getSummary = async () => {
  const [companies, invoiceStats, purchaseStats, expenseStats, subscriptions, companyStats] =
    await Promise.allSettled([
      authService.listCompanies({ limit: 50, sort: 'created_at:desc' }),
      retailService.getInvoiceStats({}),
      retailService.getPurchaseStats({}),
      retailService.getExpenseStats({}),
      authService.getSubscriptions({ limit: 10, sort: 'created_at:desc' }),
      retailService.getCompanyWiseStats({ limit: 10 }),
    ]);

  const companiesResult = settle(companies, { data: [], total: 0 });

  return {
    totals: {
      totalUsers: companiesResult.total ?? 0,
      totalInvoices: settle(invoiceStats, { total: 0, changePct: 0 }),
      purchaseCount: settle(purchaseStats, { total: 0, changePct: 0 }),
      expenseCount: settle(expenseStats, { total: 0, changePct: 0 }),
    },
    companyStats: attachCompanyNames(
      settle(companyStats, []),
      companiesResult.data ?? []
    ),
    recentSubscriptions: settle(subscriptions, { data: [] }).data ?? [],
  };
};
