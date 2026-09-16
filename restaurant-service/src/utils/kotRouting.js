// Pure helpers behind KOT ticket generation — no database access, so the
// splitting rules can be reasoned about (and exercised) on their own.

const lineKey = (itemId, variantId) => `${itemId}::${variantId || ""}`;

/**
 * What changed for the kitchen, one entry per item/variant:
 * `delta > 0` is to be cooked, `delta < 0` is to be cancelled.
 *
 * mode "add"       — `items` are quantities being added on top of whatever the
 *                    order already sent (a new order, or more items on a table).
 * mode "reconcile" — `items` are the order's complete desired state (an edited
 *                    running order); the delta is measured against what the
 *                    kitchen has already been sent.
 *
 * `sentRows` are `{ item_id, variant_id, item_name, variant_name, qty }` with
 * `qty` the net quantity already sent (NEW + ADD − CANCEL).
 */
function computeKitchenDeltas(mode, items, sentRows = []) {
  const deltas = new Map();

  if (mode === "add") {
    for (const item of items) {
      const qty = Number(item.qty) || 0;
      if (qty <= 0) continue;
      const key = lineKey(item.menu_id, item.variant_id);
      const existing = deltas.get(key);
      if (existing) {
        existing.delta += qty;
        if (item.note && !existing.note) existing.note = item.note;
      } else {
        deltas.set(key, {
          item_id: item.menu_id,
          variant_id: item.variant_id || null,
          item_name: item.name,
          variant_name: item.variant_name || null,
          note: item.note || null,
          delta: qty,
        });
      }
    }
    return Array.from(deltas.values());
  }

  const sent = new Map();
  for (const row of sentRows) {
    sent.set(lineKey(row.item_id, row.variant_id), row);
  }

  const desired = new Map();
  for (const item of items) {
    const key = lineKey(item.menu_id, item.variant_id);
    const existing = desired.get(key);
    if (existing) {
      existing.qty += Number(item.qty) || 0;
    } else {
      desired.set(key, { ...item, qty: Number(item.qty) || 0 });
    }
  }

  for (const key of new Set([...sent.keys(), ...desired.keys()])) {
    const want = desired.get(key);
    const had = sent.get(key);
    const delta = (want ? want.qty : 0) - (had ? Number(had.qty) : 0);
    if (Math.abs(delta) < 1e-9) continue;
    deltas.set(key, {
      item_id: want ? want.menu_id : had.item_id,
      variant_id: (want ? want.variant_id : had.variant_id) || null,
      item_name: want ? want.name : had.item_name,
      variant_name: (want ? want.variant_name : had.variant_name) || null,
      // A kitchen note only means something on food still to be made.
      note: delta > 0 && want ? want.note || null : null,
      delta,
    });
  }
  return Array.from(deltas.values());
}

/**
 * The counter an item's slip goes to: its own counter when that counter is
 * active, else the branch's default counter, else null (billing printer).
 */
function resolveCounterId(routing, activeCounterIds, defaultCounterId) {
  if (routing && routing.kot_counter_id != null && activeCounterIds.has(routing.kot_counter_id)) {
    return routing.kot_counter_id;
  }
  if (defaultCounterId != null && activeCounterIds.has(defaultCounterId)) {
    return defaultCounterId;
  }
  return null;
}

/**
 * Splits kitchen deltas into tickets: one per counter per kind (a single edit
 * can both add and cancel at the same counter, and those must be separate
 * slips). Positive deltas are NEW on an order's first send, ADD afterwards.
 */
function groupIntoTickets(deltas, { routingByItem, activeCounterIds, defaultCounterId, orderHasTickets }) {
  const addType = orderHasTickets ? "ADD" : "NEW";
  const tickets = new Map();

  for (const d of deltas) {
    const routing = routingByItem.get(d.item_id);
    const counterId = resolveCounterId(routing, activeCounterIds, defaultCounterId);
    const kotType = d.delta > 0 ? addType : "CANCEL";
    const key = `${counterId ?? "none"}::${kotType}`;
    if (!tickets.has(key)) {
      tickets.set(key, { kot_counter_id: counterId, kot_type: kotType, items: [] });
    }
    const fallback = routing?.fallback_counter_id;
    tickets.get(key).items.push({
      item_id: d.item_id,
      item_name: d.item_name,
      variant_id: d.variant_id,
      variant_name: d.variant_name,
      qty: Math.abs(d.delta),
      note: d.note,
      fallback_counter_id:
        fallback != null && fallback !== counterId && activeCounterIds.has(fallback) ? fallback : null,
    });
  }

  // Cancellations first: the kitchen should stop making something before it
  // reads what else to start.
  return Array.from(tickets.values()).sort((a, b) => {
    if (a.kot_type === b.kot_type) return 0;
    return a.kot_type === "CANCEL" ? -1 : 1;
  });
}

module.exports = { computeKitchenDeltas, resolveCounterId, groupIntoTickets, lineKey };
