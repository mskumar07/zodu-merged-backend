const repository = require("../repository/kot-repo");

// Services answer { success, data } or { success: false, status, message } so
// the controller can pass the status through without re-deciding it.
const fail = (status, message) => ({ success: false, status, message });
const ok = (data) => ({ success: true, data });

async function counterBelongs(id, zodu_id, branch_id) {
  return id == null || !!(await repository.getCounter(id, zodu_id, branch_id));
}

async function printerBelongs(id, zodu_id, branch_id) {
  return id == null || !!(await repository.getPrinter(id, zodu_id, branch_id));
}

// ─── Printers ────────────────────────────────────────────────────────────────

exports.listPrinters = async (zodu_id, branch_id) => ok(await repository.listPrinters(zodu_id, branch_id));

exports.createPrinter = async (input) => ok(await repository.createPrinter(input));

exports.updatePrinter = async (id, input) => {
  const printer = await repository.updatePrinter(id, input);
  return printer ? ok(printer) : fail(404, "Printer not found");
};

exports.deletePrinter = async (id, zodu_id, branch_id) =>
  (await repository.deletePrinter(id, zodu_id, branch_id)) ? ok(true) : fail(404, "Printer not found");

// ─── Counters ────────────────────────────────────────────────────────────────

exports.listCounters = async (zodu_id, branch_id) => ok(await repository.listCounters(zodu_id, branch_id));

exports.createCounter = async (input) => {
  if (await repository.counterNameTaken(input.zodu_id, input.branch_id, input.counter_name)) {
    return fail(409, `A KOT counter named "${input.counter_name}" already exists`);
  }
  if (!(await printerBelongs(input.printer_id, input.zodu_id, input.branch_id))) {
    return fail(400, "Selected printer does not belong to this branch");
  }
  return ok(await repository.createCounter(input));
};

exports.updateCounter = async (id, input) => {
  if (await repository.counterNameTaken(input.zodu_id, input.branch_id, input.counter_name, id)) {
    return fail(409, `A KOT counter named "${input.counter_name}" already exists`);
  }
  if (!(await printerBelongs(input.printer_id, input.zodu_id, input.branch_id))) {
    return fail(400, "Selected printer does not belong to this branch");
  }
  const counter = await repository.updateCounter(id, input);
  return counter ? ok(counter) : fail(404, "KOT counter not found");
};

exports.deleteCounter = async (id, zodu_id, branch_id) =>
  (await repository.deleteCounter(id, zodu_id, branch_id)) ? ok(true) : fail(404, "KOT counter not found");

// ─── Settings ────────────────────────────────────────────────────────────────

exports.getSettings = async (zodu_id, branch_id) => ok(await repository.getSettings(zodu_id, branch_id));

exports.updateSettings = async (input) => {
  if (!(await counterBelongs(input.default_counter_id, input.zodu_id, input.branch_id))) {
    return fail(400, "Default counter does not belong to this branch");
  }
  if (!(await printerBelongs(input.billing_printer_id, input.zodu_id, input.branch_id))) {
    return fail(400, "Billing printer does not belong to this branch");
  }
  return ok(await repository.upsertSettings(input));
};

/** Everything the POS needs to route and print tickets, in one request. */
exports.getConfig = async (zodu_id, branch_id) => {
  const [counters, printers, settings] = await Promise.all([
    repository.listCounters(zodu_id, branch_id),
    repository.listPrinters(zodu_id, branch_id),
    repository.getSettings(zodu_id, branch_id),
  ]);
  return ok({ counters, printers, settings });
};

// ─── Item routing ────────────────────────────────────────────────────────────

exports.getAssignment = async (zodu_id, branch_id) => ok(await repository.getAssignment(zodu_id, branch_id));

exports.assignCounterItems = async (input) => {
  if (!(await counterBelongs(input.kot_counter_id, input.zodu_id, input.branch_id))) {
    return fail(404, "KOT counter not found");
  }
  const updated = await repository.assignCounterItems(input);
  return ok({ updated });
};

exports.getItemRouting = async (zodu_id, branch_id, menu_id) => {
  const routing = await repository.getItemRouting(zodu_id, branch_id, menu_id);
  return routing ? ok(routing) : fail(404, "Menu item not found");
};

exports.updateItemRouting = async (input) => {
  if (input.fallback_counter_id != null && input.fallback_counter_id === input.kot_counter_id) {
    return fail(400, "Fallback counter must be different from the item's counter");
  }
  for (const id of [input.kot_counter_id, input.fallback_counter_id]) {
    if (!(await counterBelongs(id, input.zodu_id, input.branch_id))) {
      return fail(400, "KOT counter does not belong to this branch");
    }
  }
  const routing = await repository.updateItemRouting(input);
  return routing ? ok(routing) : fail(404, "Menu item not found");
};

// ─── Tickets ─────────────────────────────────────────────────────────────────

exports.getOrderTickets = async (zodu_id, branch_id, api_order_id) =>
  ok(await repository.getOrderTickets(zodu_id, branch_id, api_order_id));

exports.addPrintLogs = async ({ zodu_id, branch_id, entries }) => {
  for (const ticketId of new Set(entries.map((e) => e.ticket_id))) {
    if (!(await repository.ticketBelongsToBranch(ticketId, zodu_id, branch_id))) {
      return fail(404, `KOT ticket ${ticketId} not found`);
    }
  }
  return ok({ logged: await repository.addPrintLogs(entries) });
};

/**
 * Called by the order flow once an order is saved. A KOT failure must never
 * fail the order itself — the food is already on the bill — so errors come
 * back as `kot_error` for the POS to surface instead of being thrown.
 */
exports.generateTicketsForOrder = async (ctx) => {
  try {
    return { kot: await repository.generateTickets(ctx), kot_error: null };
  } catch (err) {
    console.error("KOT ticket generation failed:", err);
    return { kot: null, kot_error: err.message };
  }
};
