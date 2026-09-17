const conn = require("../database/connection");
const { computeKitchenDeltas, groupIntoTickets } = require("../utils/kotRouting");

// KOT tickets number per day in the restaurant's own day, not the server's.
const BUSINESS_TZ = "Asia/Kolkata";

const DEFAULT_SETTINGS = {
  kot_printing_enabled: true,
  default_counter_id: null,
  billing_printer_id: null,
  print_all_at_billing: false,
  billing_copy_mode: "consolidated",
  max_retries: 1,
};

// Runs `fn` inside a transaction on one dedicated pool client. BEGIN/COMMIT on
// the pool itself would each land on whatever client is free, not the same one.
async function withTransaction(fn) {
  const client = await conn.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Printers ────────────────────────────────────────────────────────────────

const PRINTER_COLUMNS = `
  p.id, p.printer_uuid, p.zodu_id, p.branch_id, p.printer_name, p.connection_type,
  p.ip_address, p.port, p.device_name, p.paper_size, p.cut_mode, p.role, p.active,
  p.created_at, p.updated_at`;

exports.listPrinters = async (zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT ${PRINTER_COLUMNS} FROM tbl_kot_printers p
     WHERE p.zodu_id = $1 AND p.branch_id = $2
     ORDER BY p.printer_name`,
    [zodu_id, branch_id]
  );
  return rows;
};

exports.getPrinter = async (id, zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT ${PRINTER_COLUMNS} FROM tbl_kot_printers p WHERE p.id = $1 AND p.zodu_id = $2 AND p.branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

exports.createPrinter = async (data) => {
  const { rows } = await conn.query(
    `INSERT INTO tbl_kot_printers
       (zodu_id, branch_id, printer_name, connection_type, ip_address, port, device_name, paper_size, role, active, cut_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.zodu_id, data.branch_id, data.printer_name, data.connection_type,
      data.ip_address || null, data.port ?? null, data.device_name || null,
      data.paper_size, data.role, data.active, data.cut_mode || "partial",
    ]
  );
  return rows[0];
};

exports.updatePrinter = async (id, data) => {
  const { rows } = await conn.query(
    `UPDATE tbl_kot_printers SET
       printer_name = $1, connection_type = $2, ip_address = $3, port = $4, device_name = $5,
       paper_size = $6, role = $7, active = $8, cut_mode = $12, updated_at = CURRENT_TIMESTAMP
     WHERE id = $9 AND zodu_id = $10 AND branch_id = $11
     RETURNING *`,
    [
      data.printer_name, data.connection_type, data.ip_address || null, data.port ?? null,
      data.device_name || null, data.paper_size, data.role, data.active,
      id, data.zodu_id, data.branch_id, data.cut_mode || "partial",
    ]
  );
  return rows[0] || null;
};

exports.deletePrinter = async (id, zodu_id, branch_id) => {
  // Counters and settings pointing at it are cleared by ON DELETE SET NULL.
  const { rowCount } = await conn.query(
    `DELETE FROM tbl_kot_printers WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rowCount > 0;
};

// ─── Counters ────────────────────────────────────────────────────────────────

exports.listCounters = async (zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT c.id, c.zodu_id, c.branch_id, c.counter_name, c.counter_code, c.active,
            c.printer_id, c.print_billing_copy, c.created_at, c.updated_at,
            (s.default_counter_id = c.id) IS TRUE AS is_default,
            (SELECT COUNT(*)::int FROM tbl_menu_items m
              WHERE m.kot_counter_id = c.id AND m.zodu_id = c.zodu_id AND m.branch_id = c.branch_id) AS item_count
     FROM tbl_kot_counters c
     LEFT JOIN tbl_kot_settings s ON s.zodu_id = c.zodu_id AND s.branch_id = c.branch_id
     WHERE c.zodu_id = $1 AND c.branch_id = $2
     ORDER BY c.id`,
    [zodu_id, branch_id]
  );
  return rows;
};

exports.getCounter = async (id, zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT * FROM tbl_kot_counters WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rows[0] || null;
};

exports.counterNameTaken = async (zodu_id, branch_id, counter_name, excludeId = null) => {
  const { rows } = await conn.query(
    `SELECT 1 FROM tbl_kot_counters
     WHERE zodu_id = $1 AND branch_id = $2 AND LOWER(counter_name) = LOWER($3)
       AND ($4::int IS NULL OR id <> $4)`,
    [zodu_id, branch_id, counter_name, excludeId]
  );
  return rows.length > 0;
};

exports.createCounter = async (data) =>
  withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`kot-counter:${data.zodu_id}:${data.branch_id}`]);
    const { rows: seqRows } = await client.query(
      `SELECT COALESCE(MAX((regexp_match(counter_code, '([0-9]+)$'))[1]::int), 0) + 1 AS next
       FROM tbl_kot_counters WHERE zodu_id = $1 AND branch_id = $2`,
      [data.zodu_id, data.branch_id]
    );
    const { rows } = await client.query(
      `INSERT INTO tbl_kot_counters (zodu_id, branch_id, counter_name, counter_code, printer_id, print_billing_copy, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        data.zodu_id, data.branch_id, data.counter_name, `KOT${seqRows[0].next}`,
        data.printer_id ?? null, data.print_billing_copy ?? false, data.active ?? true,
      ]
    );
    const counter = rows[0];
    if (data.is_default) await setDefaultCounter(client, data.zodu_id, data.branch_id, counter.id);
    return counter;
  });

exports.updateCounter = async (id, data) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE tbl_kot_counters SET
         counter_name = $1, printer_id = $2, print_billing_copy = $3, active = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND zodu_id = $6 AND branch_id = $7
       RETURNING *`,
      [data.counter_name, data.printer_id ?? null, data.print_billing_copy, data.active, id, data.zodu_id, data.branch_id]
    );
    const counter = rows[0];
    if (!counter) return null;
    if (data.is_default === true) {
      await setDefaultCounter(client, data.zodu_id, data.branch_id, id);
    } else if (data.is_default === false) {
      await client.query(
        `UPDATE tbl_kot_settings SET default_counter_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE zodu_id = $1 AND branch_id = $2 AND default_counter_id = $3`,
        [data.zodu_id, data.branch_id, id]
      );
    }
    return counter;
  });

exports.deleteCounter = async (id, zodu_id, branch_id) => {
  // Items routed here, fallbacks and the default-counter setting are cleared by
  // ON DELETE SET NULL; those items then route to the default counter.
  const { rowCount } = await conn.query(
    `DELETE FROM tbl_kot_counters WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [id, zodu_id, branch_id]
  );
  return rowCount > 0;
};

async function setDefaultCounter(client, zodu_id, branch_id, counterId) {
  await client.query(
    `INSERT INTO tbl_kot_settings (zodu_id, branch_id, default_counter_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (zodu_id, branch_id) DO UPDATE SET default_counter_id = EXCLUDED.default_counter_id, updated_at = CURRENT_TIMESTAMP`,
    [zodu_id, branch_id, counterId]
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings(zodu_id, branch_id, db = conn) {
  const { rows } = await db.query(
    `SELECT kot_printing_enabled, default_counter_id, billing_printer_id, print_all_at_billing,
            billing_copy_mode, max_retries
     FROM tbl_kot_settings WHERE zodu_id = $1 AND branch_id = $2`,
    [zodu_id, branch_id]
  );
  return { zodu_id, branch_id, ...DEFAULT_SETTINGS, ...(rows[0] || {}) };
}
exports.getSettings = getSettings;

exports.upsertSettings = async (data) => {
  await conn.query(
    `INSERT INTO tbl_kot_settings
       (zodu_id, branch_id, kot_printing_enabled, default_counter_id, billing_printer_id,
        print_all_at_billing, billing_copy_mode, max_retries)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (zodu_id, branch_id) DO UPDATE SET
       kot_printing_enabled = EXCLUDED.kot_printing_enabled,
       default_counter_id   = EXCLUDED.default_counter_id,
       billing_printer_id   = EXCLUDED.billing_printer_id,
       print_all_at_billing = EXCLUDED.print_all_at_billing,
       billing_copy_mode    = EXCLUDED.billing_copy_mode,
       max_retries          = EXCLUDED.max_retries,
       updated_at           = CURRENT_TIMESTAMP`,
    [
      data.zodu_id, data.branch_id, data.kot_printing_enabled, data.default_counter_id ?? null,
      data.billing_printer_id ?? null, data.print_all_at_billing, data.billing_copy_mode, data.max_retries,
    ]
  );
  return getSettings(data.zodu_id, data.branch_id);
};

// ─── Item routing ────────────────────────────────────────────────────────────

exports.getAssignment = async (zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT c.id AS category_id, c.name AS category_name,
            m.item_uuid AS menu_item_id, m.menu_id, m.menu_name,
            m.kot_counter_id, m.fallback_counter_id
     FROM tbl_menu_items m
     JOIN tbl_category c ON c.id = m.menu_category_id
     WHERE m.zodu_id = $1 AND m.branch_id = $2 AND m.active = TRUE
     ORDER BY c.name, c.id, m.menu_name`,
    [zodu_id, branch_id]
  );
  const categories = new Map();
  for (const row of rows) {
    if (!categories.has(row.category_id)) {
      categories.set(row.category_id, { category_id: row.category_id, category_name: row.category_name, items: [] });
    }
    categories.get(row.category_id).items.push({
      menu_item_id: row.menu_item_id,
      menu_id: row.menu_id,
      menu_name: row.menu_name,
      kot_counter_id: row.kot_counter_id,
      fallback_counter_id: row.fallback_counter_id,
    });
  }
  return Array.from(categories.values());
};

/**
 * The bulk-assign screen sends a counter's complete item list: everything in
 * it moves to the counter, and anything the counter had that is no longer in
 * it is unassigned (and so routes to the default counter).
 */
exports.assignCounterItems = async ({ zodu_id, branch_id, kot_counter_id, menu_item_ids }) =>
  withTransaction(async (client) => {
    await client.query(
      `UPDATE tbl_menu_items SET kot_counter_id = NULL
       WHERE zodu_id = $1 AND branch_id = $2 AND kot_counter_id = $3
         AND NOT (item_uuid::text = ANY($4::text[]))`,
      [zodu_id, branch_id, kot_counter_id, menu_item_ids]
    );
    const { rowCount } = await client.query(
      `UPDATE tbl_menu_items SET kot_counter_id = $3,
         -- A fallback to the item's own counter would reroute nowhere.
         fallback_counter_id = NULLIF(fallback_counter_id, $3)
       WHERE zodu_id = $1 AND branch_id = $2 AND item_uuid::text = ANY($4::text[])`,
      [zodu_id, branch_id, kot_counter_id, menu_item_ids]
    );
    return rowCount;
  });

exports.getItemRouting = async (zodu_id, branch_id, menu_id) => {
  const { rows } = await conn.query(
    `SELECT menu_id, kot_counter_id, fallback_counter_id FROM tbl_menu_items
     WHERE zodu_id = $1 AND branch_id = $2 AND menu_id = $3`,
    [zodu_id, branch_id, menu_id]
  );
  return rows[0] || null;
};

exports.updateItemRouting = async ({ zodu_id, branch_id, menu_id, kot_counter_id, fallback_counter_id }) => {
  const { rows } = await conn.query(
    `UPDATE tbl_menu_items SET kot_counter_id = $4, fallback_counter_id = $5
     WHERE zodu_id = $1 AND branch_id = $2 AND menu_id = $3
     RETURNING menu_id, kot_counter_id, fallback_counter_id`,
    [zodu_id, branch_id, menu_id, kot_counter_id ?? null, fallback_counter_id ?? null]
  );
  return rows[0] || null;
};

// ─── Tickets ─────────────────────────────────────────────────────────────────

/**
 * Stores the kitchen tickets for what just changed on an order and returns
 * them for printing, or null when nothing changed for the kitchen.
 *
 * ctx: { zodu_id, branch_id, api_order_id, order_type, table_no, customer_name,
 *        customer_phone, delivery_address, waiter_name, covers, items,
 *        mode: "add" | "reconcile", public_order_no? }
 */
exports.generateTickets = async (ctx) =>
  withTransaction(async (client) => {
    // One sender at a time per branch, so kot_no / order_seq can't collide.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`kot:${ctx.zodu_id}:${ctx.branch_id}`]);

    const settings = await getSettings(ctx.zodu_id, ctx.branch_id, client);

    const { rows: sentRows } = await client.query(
      `SELECT ti.item_id, ti.variant_id,
              (ARRAY_AGG(ti.item_name ORDER BY t.id DESC))[1] AS item_name,
              (ARRAY_AGG(ti.variant_name ORDER BY t.id DESC))[1] AS variant_name,
              SUM(CASE WHEN t.kot_type = 'CANCEL' THEN -ti.qty ELSE ti.qty END) AS qty
       FROM tbl_kot_tickets t
       JOIN tbl_kot_ticket_items ti ON ti.ticket_id = t.id
       WHERE t.api_order_id = $1 AND t.zodu_id = $2 AND t.branch_id = $3
       GROUP BY ti.item_id, ti.variant_id`,
      [ctx.api_order_id, ctx.zodu_id, ctx.branch_id]
    );
    const { rows: priorRows } = await client.query(
      `SELECT order_no, order_seq FROM tbl_kot_tickets
       WHERE api_order_id = $1 AND zodu_id = $2 AND branch_id = $3
       ORDER BY id LIMIT 1`,
      [ctx.api_order_id, ctx.zodu_id, ctx.branch_id]
    );
    const orderHasTickets = priorRows.length > 0;

    const deltas = computeKitchenDeltas(ctx.mode, ctx.items, sentRows);
    if (deltas.length === 0) return null;

    const itemIds = [...new Set(deltas.map((d) => d.item_id))];
    const { rows: routingRows } = await client.query(
      `SELECT menu_id, kot_counter_id, fallback_counter_id FROM tbl_menu_items
       WHERE zodu_id = $1 AND branch_id = $2 AND menu_id = ANY($3::text[])`,
      [ctx.zodu_id, ctx.branch_id, itemIds]
    );
    const { rows: counterRows } = await client.query(
      `SELECT id, counter_name FROM tbl_kot_counters WHERE zodu_id = $1 AND branch_id = $2 AND active = TRUE`,
      [ctx.zodu_id, ctx.branch_id]
    );
    const counterNames = new Map(counterRows.map((c) => [c.id, c.counter_name]));

    const groups = groupIntoTickets(deltas, {
      routingByItem: new Map(routingRows.map((r) => [r.menu_id, r])),
      activeCounterIds: new Set(counterNames.keys()),
      defaultCounterId: settings.default_counter_id,
      orderHasTickets,
    });

    const { rows: dayRows } = await client.query(
      `SELECT (NOW() AT TIME ZONE $1)::date AS today,
              COALESCE(MAX(order_seq), 0) + 1 AS next_order_seq
       FROM tbl_kot_tickets
       WHERE zodu_id = $2 AND branch_id = $3 AND kot_date = (NOW() AT TIME ZONE $1)::date`,
      [BUSINESS_TZ, ctx.zodu_id, ctx.branch_id]
    );
    const { today, next_order_seq: nextOrderSeq } = dayRows[0];

    // Scoped to this order alone (see kot_ticket_no_per_order.sql) — resets
    // to 1 for every new api_order_id, instead of running for the whole
    // branch/day. One call per send: every counter's split ticket below
    // shares this same number.
    const { rows: kotNoRows } = await client.query(
      `SELECT fn_next_kot_no($1, $2, $3) AS next_kot`,
      [ctx.zodu_id, ctx.branch_id, ctx.api_order_id]
    );
    const kotNo = kotNoRows[0].next_kot;

    // An order keeps the number its first ticket got. A paid order is known by
    // its invoice number; a running Dine-In order gets a short daily number.
    let orderNo;
    let orderSeq = null;
    if (orderHasTickets) {
      orderNo = priorRows[0].order_no;
      orderSeq = priorRows[0].order_seq;
    } else if (ctx.public_order_no) {
      orderNo = ctx.public_order_no;
    } else {
      orderSeq = nextOrderSeq;
      orderNo = String(orderSeq).padStart(3, "0");
    }

    const tickets = [];
    for (const group of groups) {
      const counterName = group.kot_counter_id != null ? counterNames.get(group.kot_counter_id) : null;
      const { rows } = await client.query(
        `INSERT INTO tbl_kot_tickets (
           zodu_id, branch_id, api_order_id, kot_no, kot_date, kot_type, kot_counter_id, counter_name,
           order_type, table_no, order_no, order_seq, customer_name, customer_phone,
           delivery_address, waiter_name, covers
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id, created_at`,
        [
          ctx.zodu_id, ctx.branch_id, ctx.api_order_id, kotNo, today, group.kot_type,
          group.kot_counter_id, counterName, ctx.order_type,
          ctx.table_no != null && ctx.table_no !== "" ? String(ctx.table_no) : null,
          orderNo, orderSeq, ctx.customer_name || null, ctx.customer_phone || null,
          ctx.delivery_address || null, ctx.waiter_name || null, ctx.covers || null,
        ]
      );
      const ticket = rows[0];
      for (const item of group.items) {
        await client.query(
          `INSERT INTO tbl_kot_ticket_items
             (ticket_id, item_id, item_name, variant_id, variant_name, qty, note, fallback_counter_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ticket.id, item.item_id, item.item_name, item.variant_id, item.variant_name, item.qty, item.note, item.fallback_counter_id]
        );
      }
      tickets.push({
        ticket_id: ticket.id,
        kot_type: group.kot_type,
        kot_counter_id: group.kot_counter_id,
        counter_name: counterName,
        created_at: ticket.created_at,
        print_status: null,
        items: group.items.map((i) => ({
          item_id: i.item_id,
          item_name: i.item_name,
          variant_name: i.variant_name,
          qty: Number(i.qty),
          note: i.note,
          fallback_counter_id: i.fallback_counter_id,
        })),
      });
    }

    return {
      api_order_id: ctx.api_order_id,
      kot_no: kotNo,
      order_no: orderNo,
      order_type: ctx.order_type,
      table_no: ctx.table_no != null && ctx.table_no !== "" ? String(ctx.table_no) : null,
      customer_name: ctx.customer_name || null,
      customer_phone: ctx.customer_phone || null,
      delivery_address: ctx.delivery_address || null,
      waiter_name: ctx.waiter_name || null,
      covers: ctx.covers || null,
      tickets,
    };
  });

/** Every ticket an order has produced, newest send first, grouped per send. */
exports.getOrderTickets = async (zodu_id, branch_id, api_order_id) => {
  const { rows } = await conn.query(
    `SELECT t.id AS ticket_id, t.api_order_id, t.kot_no, t.kot_date::text AS kot_date, t.kot_type, t.kot_counter_id, t.counter_name,
            t.order_type, t.table_no, t.order_no, t.customer_name, t.customer_phone,
            t.delivery_address, t.waiter_name, t.covers, t.created_at,
            (SELECT l.status FROM tbl_kot_print_log l WHERE l.ticket_id = t.id
              ORDER BY l.id DESC LIMIT 1) AS print_status,
            COALESCE((
              SELECT JSON_AGG(JSON_BUILD_OBJECT(
                'item_id', ti.item_id, 'item_name', ti.item_name, 'variant_name', ti.variant_name,
                'qty', ti.qty::float, 'note', ti.note, 'fallback_counter_id', ti.fallback_counter_id
              ) ORDER BY ti.id)
              FROM tbl_kot_ticket_items ti WHERE ti.ticket_id = t.id
            ), '[]') AS items
     FROM tbl_kot_tickets t
     WHERE t.zodu_id = $1 AND t.branch_id = $2 AND t.api_order_id = $3
     ORDER BY t.id DESC`,
    [zodu_id, branch_id, api_order_id]
  );

  const batches = new Map();
  for (const row of rows) {
    const key = `${row.kot_date}::${row.kot_no}`;
    if (!batches.has(key)) {
      batches.set(key, {
        api_order_id: row.api_order_id,
        kot_no: row.kot_no,
        order_no: row.order_no,
        order_type: row.order_type,
        table_no: row.table_no,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        delivery_address: row.delivery_address,
        waiter_name: row.waiter_name,
        covers: row.covers,
        tickets: [],
      });
    }
    batches.get(key).tickets.push({
      ticket_id: row.ticket_id,
      kot_type: row.kot_type,
      kot_counter_id: row.kot_counter_id,
      counter_name: row.counter_name,
      created_at: row.created_at,
      print_status: row.print_status,
      items: row.items,
    });
  }
  return Array.from(batches.values());
};

exports.ticketBelongsToBranch = async (ticket_id, zodu_id, branch_id) => {
  const { rows } = await conn.query(
    `SELECT 1 FROM tbl_kot_tickets WHERE id = $1 AND zodu_id = $2 AND branch_id = $3`,
    [ticket_id, zodu_id, branch_id]
  );
  return rows.length > 0;
};

exports.addPrintLogs = async (entries) =>
  withTransaction(async (client) => {
    for (const e of entries) {
      await client.query(
        `INSERT INTO tbl_kot_print_log (ticket_id, printer_id, printer_name, target, status, attempts, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [e.ticket_id, e.printer_id ?? null, e.printer_name || null, e.target, e.status, e.attempts ?? 1, e.error || null]
      );
    }
    return entries.length;
  });
