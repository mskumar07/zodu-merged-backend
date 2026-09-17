-- KOT counters, printers and per-counter kitchen tickets.
--
-- Every order line is routed to the KOT counter its menu item is assigned to,
-- and each counter's slice of an order is stored as its own ticket
-- (tbl_kot_tickets / tbl_kot_ticket_items). A ticket is NEW for an order's
-- first send to the kitchen, ADD for items added after that, and CANCEL for
-- quantities removed after they were sent — so the kitchen always receives a
-- slip for exactly what changed.
--
-- Printing itself happens on the restaurant's own network, through the local
-- print bridge the POS talks to. The backend only stores the configuration and
-- the tickets, and records what the POS reports back in tbl_kot_print_log.
--
-- tbl_kot_list is left untouched: the running-orders screen still reads it.
--
-- Run this once against the restaurant-service database.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- throughout, so a database that already has some of these objects converges.

-- ── Printers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_kot_printers (
    id SERIAL PRIMARY KEY,
    zodu_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    printer_name VARCHAR(60) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tbl_kot_printers
    ADD COLUMN IF NOT EXISTS printer_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    -- LAN: raw TCP (ESC/POS) to ip_address:port.
    -- USB / BLUETOOTH: device_name is the printer's name as installed on the
    -- billing PC, or a serial port (COM5, /dev/rfcomm0) for Bluetooth SPP.
    ADD COLUMN IF NOT EXISTS connection_type VARCHAR(12) NOT NULL DEFAULT 'LAN',
    ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64),
    ADD COLUMN IF NOT EXISTS port INT DEFAULT 9100,
    ADD COLUMN IF NOT EXISTS device_name VARCHAR(120),
    -- Thermal roll width in inches: '2' (58 mm) or '3' (80 mm).
    ADD COLUMN IF NOT EXISTS paper_size VARCHAR(2) NOT NULL DEFAULT '3',
    -- Auto cutter after each slip: partial | full | none (feed only, tear by hand).
    ADD COLUMN IF NOT EXISTS cut_mode VARCHAR(10) NOT NULL DEFAULT 'partial',
    -- kot_counter | billing | both
    ADD COLUMN IF NOT EXISTS role VARCHAR(12) NOT NULL DEFAULT 'kot_counter',
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_kot_printers_branch ON tbl_kot_printers (zodu_id, branch_id);

-- ── Counters ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_kot_counters (
    id SERIAL PRIMARY KEY,
    zodu_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    counter_name VARCHAR(40) NOT NULL,
    counter_code VARCHAR(20) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tbl_kot_counters
    ADD COLUMN IF NOT EXISTS printer_id INT REFERENCES tbl_kot_printers(id) ON DELETE SET NULL,
    -- Also send this counter's ticket to the billing printer.
    ADD COLUMN IF NOT EXISTS print_billing_copy BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_kot_counters_branch ON tbl_kot_counters (zodu_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kot_counters_name
    ON tbl_kot_counters (zodu_id, branch_id, LOWER(counter_name));

-- ── Branch-level KOT settings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_kot_settings (
    zodu_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (zodu_id, branch_id)
);

ALTER TABLE tbl_kot_settings
    ADD COLUMN IF NOT EXISTS kot_printing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Where unassigned (or newly created) items route until they are mapped.
    ADD COLUMN IF NOT EXISTS default_counter_id INT REFERENCES tbl_kot_counters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS billing_printer_id INT REFERENCES tbl_kot_printers(id) ON DELETE SET NULL,
    -- Master switch: print every ticket at the billing printer too.
    ADD COLUMN IF NOT EXISTS print_all_at_billing BOOLEAN NOT NULL DEFAULT FALSE,
    -- consolidated: one slip with every counter's items | per_counter: a copy of each split slip
    ADD COLUMN IF NOT EXISTS billing_copy_mode VARCHAR(12) NOT NULL DEFAULT 'consolidated',
    -- Extra attempts on a counter's own printer before falling back.
    ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ── Menu item routing ──────────────────────────────────────────────────────
ALTER TABLE tbl_menu_items
    ADD COLUMN IF NOT EXISTS kot_counter_id INT REFERENCES tbl_kot_counters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS fallback_counter_id INT REFERENCES tbl_kot_counters(id) ON DELETE SET NULL;

-- ── Tickets ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_kot_tickets (
    id SERIAL PRIMARY KEY,
    zodu_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    api_order_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tbl_kot_tickets
    -- Shared by every counter's slip from one send, so the split slips of a
    -- single order can be matched up. Restarts at 1 each day per branch.
    ADD COLUMN IF NOT EXISTS kot_no INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS kot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    -- NEW | ADD | CANCEL
    ADD COLUMN IF NOT EXISTS kot_type VARCHAR(10) NOT NULL DEFAULT 'NEW',
    -- NULL when the item had no counter and no default counter existed; such
    -- slips print at the billing printer.
    ADD COLUMN IF NOT EXISTS kot_counter_id INT REFERENCES tbl_kot_counters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS counter_name VARCHAR(40),
    ADD COLUMN IF NOT EXISTS order_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS table_no VARCHAR(20),
    -- The invoice number for Pick Up / Delivery; a per-day running number
    -- (order_seq) for Dine-In, whose invoice number only exists once it is paid.
    ADD COLUMN IF NOT EXISTS order_no VARCHAR(60),
    ADD COLUMN IF NOT EXISTS order_seq INT,
    ADD COLUMN IF NOT EXISTS customer_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_address TEXT,
    ADD COLUMN IF NOT EXISTS waiter_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS covers INT;

CREATE INDEX IF NOT EXISTS idx_kot_tickets_order ON tbl_kot_tickets (api_order_id);
CREATE INDEX IF NOT EXISTS idx_kot_tickets_day ON tbl_kot_tickets (zodu_id, branch_id, kot_date);

CREATE TABLE IF NOT EXISTS tbl_kot_ticket_items (
    id SERIAL PRIMARY KEY,
    ticket_id INT NOT NULL REFERENCES tbl_kot_tickets(id) ON DELETE CASCADE,
    item_id VARCHAR(100) NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    variant_id VARCHAR(100),
    variant_name VARCHAR(100),
    qty NUMERIC(10,2) NOT NULL,
    note VARCHAR(200),
    fallback_counter_id INT REFERENCES tbl_kot_counters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kot_ticket_items_ticket ON tbl_kot_ticket_items (ticket_id);

-- ── Print log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_kot_print_log (
    id SERIAL PRIMARY KEY,
    ticket_id INT NOT NULL REFERENCES tbl_kot_tickets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tbl_kot_print_log
    ADD COLUMN IF NOT EXISTS printer_id INT REFERENCES tbl_kot_printers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS printer_name VARCHAR(60),
    -- counter | fallback | billing
    ADD COLUMN IF NOT EXISTS target VARCHAR(10) NOT NULL DEFAULT 'counter',
    -- success | failed | reprinted
    ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL,
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS idx_kot_print_log_ticket ON tbl_kot_print_log (ticket_id);
