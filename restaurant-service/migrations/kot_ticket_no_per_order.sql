-- KOT ticket numbers (kot_no) reset to 1 for each order instead of running
-- continuously for the whole branch/day. fn_next_kot_no computes the next
-- number scoped to one api_order_id (MAX(kot_no) for that order + 1, or 1
-- if the order has no tickets yet).
--
-- This is a function the app calls ONCE per "send" (see kot-repo.js's
-- generateTickets), not a per-row insert trigger — every counter's split
-- slip from the same send must share one kot_no (already true before this
-- migration; only the scope of the number changed, from day+branch to the
-- order itself), and a per-row trigger would hand each row in the same send
-- a different number. Callers already hold
-- pg_advisory_xact_lock(hashtext('kot:'||zodu_id||':'||branch_id)) for the
-- duration of the transaction, so no separate locking is needed here.
CREATE OR REPLACE FUNCTION fn_next_kot_no(p_zodu_id VARCHAR, p_branch_id VARCHAR, p_api_order_id VARCHAR)
RETURNS INT AS $$
DECLARE
    next_no INT;
BEGIN
    SELECT COALESCE(MAX(kot_no), 0) + 1 INTO next_no
    FROM tbl_kot_tickets
    WHERE zodu_id = p_zodu_id AND branch_id = p_branch_id AND api_order_id = p_api_order_id;

    RETURN next_no;
END;
$$ LANGUAGE plpgsql;

-- Once an order is finalized (a row lands in tbl_orders — see
-- restaurant-repo.js's updateFinalPayment, the Dine-In checkout / completeorder
-- flow), its kitchen tickets have done their job. Deleting them here means
-- the next order at the same table starts back at KOT 1, since a fresh
-- api_order_id has nothing for fn_next_kot_no to MAX() over.
--
-- Fires on every tbl_orders insert, including non-Dine-In orders created
-- directly (no tmp-order stage): at that point in the flow no KOT tickets
-- exist for the brand-new api_order_id yet (they're created right after —
-- see orders-service.js's createOrder), so the delete is a harmless no-op
-- there and the tickets created moments later are unaffected.
--
-- tbl_kot_ticket_items and tbl_kot_print_log cascade via their own
-- ON DELETE CASCADE FKs to tbl_kot_tickets, so deleting here is enough.
-- tbl_orders.api_order_id is UUID; tbl_kot_tickets.api_order_id is VARCHAR —
-- cast explicitly, since Postgres has no UUID = VARCHAR operator.
CREATE OR REPLACE FUNCTION fn_purge_kot_on_order_complete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM tbl_kot_tickets
    WHERE zodu_id = NEW.zodu_id AND branch_id = NEW.branch_id AND api_order_id = NEW.api_order_id::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purge_kot_on_order_complete ON tbl_orders;

CREATE TRIGGER trg_purge_kot_on_order_complete
    AFTER INSERT ON tbl_orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_purge_kot_on_order_complete();
