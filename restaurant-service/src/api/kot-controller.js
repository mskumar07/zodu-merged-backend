const express = require("express");
const RequestValidator = require("../utils/requestValidator");
const schema = require("../schema/kot-schema");
const service = require("../services/kot-service");

// Mounted at "/", so paths read /restaurant/<path> through the gateway — the
// same shape as the counter/assignment endpoints the web app already calls.
const router = express.Router();

// Wraps a handler so validation, service failures and thrown errors all answer
// in the one shape the web app's extractErrorMessage understands.
function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req);
      if (result.errors) return res.status(400).json({ message: result.errors });
      if (!result.success) return res.status(result.status || 400).json({ message: result.message });
      return res.status(result.created ? 201 : 200).json({ success: true, data: result.data });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: error.message });
    }
  };
}

async function validated(schemaDef, body, run) {
  const { errors, input } = await RequestValidator(schemaDef, body);
  if (errors) return { errors };
  return run(input);
}

const idParam = (req) => Number.parseInt(req.params.id, 10);

// ── Counters ────────────────────────────────────────────────────────────────
router.get("/get/kot-counters/:zodu_id/:branch_id", handle((req) =>
  service.listCounters(req.params.zodu_id, req.params.branch_id)));

router.post("/add/kot-counter", handle((req) =>
  validated(schema.counterCreate, req.body, async (input) => ({ ...(await service.createCounter(input)), created: true }))));

router.put("/update/kot-counter/:id", handle((req) =>
  validated(schema.counterUpdate, req.body, (input) => service.updateCounter(idParam(req), input))));

router.delete("/delete/kot-counter/:id/:zodu_id/:branch_id", handle((req) =>
  service.deleteCounter(idParam(req), req.params.zodu_id, req.params.branch_id)));

// ── Item → counter mapping ──────────────────────────────────────────────────
router.get("/get/kot-assignment/:zodu_id/:branch_id", handle((req) =>
  service.getAssignment(req.params.zodu_id, req.params.branch_id)));

router.post("/assign/kot-counter-items", handle((req) =>
  validated(schema.assignItems, req.body, (input) => service.assignCounterItems(input))));

router.get("/get/kot-item-routing/:zodu_id/:branch_id/:menu_id", handle((req) =>
  service.getItemRouting(req.params.zodu_id, req.params.branch_id, req.params.menu_id)));

router.put("/update/kot-item-routing", handle((req) =>
  validated(schema.itemRouting, req.body, (input) => service.updateItemRouting(input))));

// ── Printers ────────────────────────────────────────────────────────────────
router.get("/get/kot-printers/:zodu_id/:branch_id", handle((req) =>
  service.listPrinters(req.params.zodu_id, req.params.branch_id)));

router.post("/add/kot-printer", handle((req) =>
  validated(schema.printer, req.body, async (input) => ({ ...(await service.createPrinter(input)), created: true }))));

router.put("/update/kot-printer/:id", handle((req) =>
  validated(schema.printer, req.body, (input) => service.updatePrinter(idParam(req), input))));

router.delete("/delete/kot-printer/:id/:zodu_id/:branch_id", handle((req) =>
  service.deletePrinter(idParam(req), req.params.zodu_id, req.params.branch_id)));

// ── Settings ────────────────────────────────────────────────────────────────
router.get("/get/kot-settings/:zodu_id/:branch_id", handle((req) =>
  service.getSettings(req.params.zodu_id, req.params.branch_id)));

router.put("/update/kot-settings", handle((req) =>
  validated(schema.settings, req.body, (input) => service.updateSettings(input))));

router.get("/get/kot-config/:zodu_id/:branch_id", handle((req) =>
  service.getConfig(req.params.zodu_id, req.params.branch_id)));

// ── Tickets & print log ─────────────────────────────────────────────────────
router.get("/get/kot-tickets/:zodu_id/:branch_id/:api_order_id", handle((req) =>
  service.getOrderTickets(req.params.zodu_id, req.params.branch_id, req.params.api_order_id)));

router.post("/add/kot-print-log", handle((req) =>
  validated(schema.printLog, req.body, (input) => service.addPrintLogs(input))));

module.exports = router;
