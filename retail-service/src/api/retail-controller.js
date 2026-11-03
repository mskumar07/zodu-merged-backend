const express = require("express");
const RequestValidator = require("../utils/requestValidator.js")
const schema = require("../schema/retail-schema.js");
const service = require("../services/retail-service.js");
const branchService = require("../services/branch-service.js");
const multer = require("multer")
const security = require("../security");
const owned = require("../security/owned");
// Memory storage. Files go on to file-service, which takes 10MB per file.
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
});
const files = require("../utils/file-client");
const attachments = require("../utils/attachments");


const router = express.Router();
// :zodu_id / :branch_id are checked against the token; record ids must be the company's.
security.protectParams(router);
router.param("sale_uuid", owned.param("tbl_sales", "sale_uuid"));
router.param("cust_uuid", owned.param("tbl_customer", "cust_uuid"));
router.param("custUuid", owned.param("tbl_customer", "cust_uuid"));


router.get("/get/branches/:zodu_id", async (req, res) => {
  try {
    const { zodu_id } = req.params;
    const result = await branchService.getBranches(zodu_id);

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Branches fetched successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("[GET /get/branches/:zodu_id]", error);
    return res.status(500).json({ error: error.message });
  }
});


// Upload first, save the record later: the file goes to file-service's staging
// area and the URL returned is a file-service link. Saving an expense / purchase
// / item with that link moves the file into the record (utils/attachments.js).
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const result = await service.uploadImg(req.file, await attachments.uploadCtx(req));
    return res.status(200).json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/upload/multiple", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const result = await service.uploadMultiple(req.files, await attachments.uploadCtx(req));


    return res.status(200).json({ success: true, files: result });
  } catch (err) {
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.message, details: err.details });
  }
});



router.post("/api/add/orders", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.order_create, req.body);
    if (errors) {
      return res.status(400).json({ errors });
    }
 
    const data = await service.createOrder(input);
 
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
 
    return res.status(201).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.put("/api/update/orders", owned.inBody("sale_uuid", "tbl_sales", "sale_uuid"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.order_update, req.body);


    if (errors) return res.status(400).json({ errors });


    const data = await service.updateOrder(input);

    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/api/sales/history", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sales_history_query, req.query);
    if (errors) return res.status(400).json({ errors });
 
    const data = await service.getSalesHistory(input);
    if (!data.success) return res.status(400).json({ message: data.message });
 
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});
 
router.get("/api/sales/history/summary", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sales_history_summary_query, req.query);
    if (errors) return res.status(400).json({ errors });

    const data = await service.getSalesHistorySummary(input);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/sales/:sale_uuid?zodu_id=&branch_id= — looked up by tbl_sales'
// primary key instead of the human-readable sale_id, which can contain
// characters (e.g. "/" from an invoice_prefix like "MA/") that don't survive
// as a single URL path segment and 404 before this handler is ever reached.
router.get("/api/sales/:sale_uuid", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sale_by_uuid_params, {
      sale_uuid: req.params.sale_uuid,
      zodu_id:   req.query.zodu_id,
      branch_id: req.query.branch_id,
    });

    if (errors) return res.status(400).json({ errors });

    const data = await service.getSaleById(input.sale_uuid, input.zodu_id, input.branch_id);
    if (!data.success) return res.status(404).json({ message: data.message });

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sales/:sale_uuid?zodu_id=&branch_id= — looked up by tbl_sales'
// primary key for the same reason as the GET route above (sale_id can contain
// "/" and 404 before reaching this handler).
router.delete("/api/sales/:sale_uuid", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sale_by_uuid_params, {
      sale_uuid: req.params.sale_uuid,
      zodu_id: req.query.zodu_id,
      branch_id: req.query.branch_id,
      sale_type: req.query.sale_type, // optional, but can be used to determine if it's a proforma
    });

    if (errors) return res.status(400).json({ errors });

    const data = await service.deleteSale(
      input.sale_uuid,
      input.zodu_id,
      input.branch_id,
      input.sale_type
    );

    if (!data.success) return res.status(404).json({ message: data.message });

    return res.status(200).json({
      success: true,
      message: data.data?.sale_type === 'P'
        ? "Proforma permanently deleted"
        : ['Q', 'quotation'].includes(data.data?.sale_type)
        ? "Quotation permanently deleted"
        : "Sale deleted successfully",
      data: data.data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


// GET /api/doc-sequence/:zodu_id/:branch_id/:doc_type — current last_seq and a
// preview of the next id (e.g. "INV-B1-145") without incrementing anything.
// doc_type: INV | QUO | PRO | PUR | EXP | CUS.
router.get("/api/doc-sequence/:zodu_id/:branch_id/:doc_type", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.doc_sequence_params, req.params);
    if (errors) return res.status(400).json({ errors });

    const data = await service.getDocSequence(input.zodu_id, input.branch_id, input.doc_type);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /api/doc-sequence/:zodu_id/:branch_id/:doc_type — manual override, body
// { last_seq }. Nudges the counter so the next generated id is last_seq + 1,
// for a branch that has skipped numbers on paper/elsewhere.
router.put("/api/doc-sequence/:zodu_id/:branch_id/:doc_type", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.doc_sequence_update, {
      ...req.params,
      last_seq: req.body.last_seq,
    });
    if (errors) return res.status(400).json({ errors });

    const data = await service.updateDocSequence(input.zodu_id, input.branch_id, input.doc_type, input.last_seq);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/sales/:sale_uuid/payment — looked up by tbl_sales' primary key
// for the same reason as the GET/DELETE routes above.
router.post("/api/sales/:sale_uuid/payment", async (req, res) => {
  try {
    const { error, value } = schema.mark_payment.validate(
      { ...req.body, sale_uuid: req.params.sale_uuid },
      { abortEarly: false }
    );
    if (error) {
      return res.status(400).json({ errors: error.details.map(d => d.message) });
    }
 
    const data = await service.markPayment(value);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});


router.post("/api/customers", async (req, res) => {
  try {
    const { error, value } = schema.add_customer.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ errors: error.details.map(d => d.message) });
    }
 
    // Normalise: single string mobile/email → array. An empty string means
    // "no number/email", not an array holding one empty string.
    if (typeof value.mobile_no === "string") value.mobile_no = value.mobile_no ? [value.mobile_no] : [];
    if (typeof value.email_id  === "string") value.email_id  = value.email_id  ? [value.email_id]  : [];
 
    const data = await service.createCustomer(value);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/api/customers", async (req, res) => {
  try {
    const { error, value } = schema.get_customers.validate(req.query, {
      abortEarly: false,
    });
 
    if (error) {
      return res.status(400).json({
        errors: error.details.map((d) => d.message),
      });
    }
 
    const data = await service.getCustomers(value);
 
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
 
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});
 
// GET /api/customers/:cust_uuid?zodu_id=&branch_id=
// Single customer record (tbl_customer only).
router.get("/api/customers/:cust_uuid", async (req, res) => {
  try {
    const { error, value } = schema.get_customer_by_id.validate(
      {
        cust_uuid: req.params.cust_uuid,
        zodu_id:   req.tenant.zoduId,
        branch_id: req.tenant.branchId,
      },
      { abortEarly: false }
    );

    if (error) {
      return res.status(400).json({ errors: error.details.map((d) => d.message) });
    }

    const data = await service.getCustomerById(value);
    if (!data.success) {
      return res.status(data.notFound ? 404 : 400).json({ message: data.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("[GET /api/customers/:cust_uuid]", err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers/:custUuid/ledger
router.get('/api/customers/:custUuid/ledger', async (req, res, next) => {
  try {
    // ✅ FIX: was only validating req.params, missing all query params
    const { error, value } = schema.ledgerSchema.validate({
      ...req.params,
      ...req.query,
    });
 
    if (error) {
      return res.status(400).json({
        success: false,
        errors: error.details.map((d) => d.message),
      });
    }
 
    // The checked company / branch (token, or the requested branch the user may use).
    const branchId = req.tenant.branchId;
    const zoduId   = req.tenant.zoduId;
 
    if (!branchId || !zoduId) {
      return res.status(400).json({
        success: false,
        errors: ['branch_id and zodu_id are required (via auth token or query param).'],
      });
    }

 
    // ✅ FIX: was calling service.getCustomerById (wrong name) and passing
    //         no arguments — now calls getCustomerLedger with all needed params
    const data = await service.getCustomerLedger({
      custUuid: value.custUuid,
      branchId,
      zoduId,
      fromDate: value.fromDate,
      toDate:   value.toDate,
      method:   value.method,
      search:   value.search,
      page:     value.page,
      limit:    value.limit,
    });
 
    return res.status(200).json({ success: true, data });
 
  } catch (err) {
    // ✅ FIX: next(err) now lives in the router where it belongs,
    //         not inside the service function
    next(err);
  }
});

// GET /api/customers/:cust_uuid/outstanding-bills?zodu_id=&branch_id=
// Feeds the "Mark Payment" modal — every unpaid/partially-paid invoice, oldest first.
router.get("/api/customers/:cust_uuid/outstanding-bills", async (req, res) => {
  try {
    const zodu_id   = req.tenant.zoduId;
    const branch_id = req.tenant.branchId;
    const { cust_uuid } = req.params;

    if (!zodu_id || !branch_id) {
      return res.status(400).json({ error: "branch_id and zodu_id are required (via auth token or query param)." });
    }

    const data = await service.getCustomerOutstandingBills({ cust_uuid, zodu_id, branch_id });
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json({ success: true, data: data.data });
  } catch (error) {
    console.error("[GET /api/customers/:cust_uuid/outstanding-bills]", error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/customers/:cust_uuid/mark-payment
// One payment (date, mode, reference, attachments) applied across several
// selected bills, oldest-first — each bill absorbs what it needs before the
// remainder rolls to the next.
router.post(
  "/api/customers/:cust_uuid/mark-payment",
  upload.array("attachments", 5),
  security.tenantBody,
  async (req, res) => {
    try {
      const body = { ...req.body, cust_uuid: req.params.cust_uuid };

      // multipart/form-data arrives as strings — normalise before validation
      if (typeof body.bills === "string") body.bills = JSON.parse(body.bills);
      if (typeof body.total_payment === "string") body.total_payment = Number(body.total_payment);

      const { error, value } = schema.mark_customer_payment.validate(body, { abortEarly: false });
      if (error) {
        return res.status(400).json({ errors: error.details.map((d) => d.message) });
      }

      value.zodu_id   = req.tenant.zoduId;
      value.branch_id = req.tenant.branchId;

      // Attachments go to file-service under the customer (module customer-payment,
      // private); the payment rows keep file refs and answer with fresh URLs.
      const fileCtx = files.requestCtx(req, { zoduId: value.zodu_id, branchId: value.branch_id });
      const stored = req.files?.length
        ? await files.upload(fileCtx, {
            module: "customer-payment", entityId: attachments.entityKey(value.cust_uuid), files: req.files,
          })
        : [];
      value.attachment_url = stored.map((f, i) => ({
        id:       f.file_id,
        filename: req.files[i].originalname || f.original_name,
        size:     req.files[i].size || 0,
        mimetype: f.mime_type,
        file_id:  f.file_id,
        file_ctx: `${value.zodu_id}/${value.branch_id || ""}`,
        url_key:  "url",
      }));

      let data;
      try {
        data = await service.markCustomerPayment(value);
      } finally {
        if (!data?.success && stored.length) {
          await files.quietly(files.remove(fileCtx, stored.map((f) => f.file_id)));
        }
      }
      if (!data.success) return res.status(400).json({ message: data.message });

      return res.status(201).json(data);
    } catch (error) {
      if (error instanceof files.FileServiceError) {
        return res.status(error.status).json({ error: error.message, details: error.details });
      }
      console.error("[POST /api/customers/:cust_uuid/mark-payment]", error);
      return res.status(500).json({ error: error.message });
    }
  }
);


router.put("/api/customers/:cust_uuid", async (req, res) => {
  try {
    const bodyData = { ...req.body, cust_uuid: req.params.cust_uuid };
    const { error, value } = schema.update_customer.validate(bodyData, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        errors: error.details.map((d) => d.message),
      });
    }

    // Normalise: single string mobile/email → array. An empty string means
    // "no number/email", not an array holding one empty string.
    if (typeof value.mobile_no === "string") value.mobile_no = value.mobile_no ? [value.mobile_no] : [];
    if (typeof value.email_id  === "string") value.email_id  = value.email_id  ? [value.email_id]  : [];

    const data = await service.updateCustomer(value);

    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// Soft delete — marks the customer inactive (or active again, if the caller
// passes is_active: true), row and history stay intact. Body is optional;
// omitting it deletes (is_active becomes false).
router.delete("/api/customers/:cust_uuid", async (req, res) => {
  try {
    const is_active = req.body?.is_active === true;
    const data = await service.deleteCustomer(req.params.cust_uuid, is_active);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});


router.get("/get/category/:type/:branch_id/:zodu_id", async (req, res) => {
  try {
    const { type, branch_id, zodu_id } = req.params;
    const page  = parseInt(req.query.page  ?? 1,  10) || 1;
    const limit = parseInt(req.query.limit ?? 10, 10) || 10;

    const getCategoryData = await service.getCategoryData(type, branch_id, zodu_id, page, limit);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });

    return res.status(200).json({
      message: "Data Get Successfully",
      pagination: {
        current_page: page,
        total_pages:  getCategoryData.total_pages,
        total_count:  getCategoryData.total_count,
        limit,
      },
      Data: getCategoryData.data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/category/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { branch_id, zodu_id } = req.params;
    const page  = parseInt(req.query.page  ?? 1,  10) || 1;
    const limit = parseInt(req.query.limit ?? 10, 10) || 10;

    // Handle ?type=S&type=M  OR  ?type[]=S&type[]=M  OR  ?type=S
    const rawType = req.query.type ?? req.query['type[]'];
    const types = rawType
      ? (Array.isArray(rawType) ? rawType : [rawType]).map(t => t.trim()).filter(Boolean)
      : [];

    // active is optional: only filter by it when the frontend explicitly passes it
    const active = req.query.active === undefined ? undefined : req.query.active === 'true';

    const category_name = req.query.category_name?.trim() || undefined;

    const getCategoryData = await service.getAllCategoryData(types, branch_id, zodu_id, page, limit, active, category_name);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });

    return res.status(200).json({
      message: "Category Data Get Successfully",
      pagination: {
        current_page: page,
        total_pages:  getCategoryData.total_pages,
        total_count:  getCategoryData.total_count,
        limit,
      },
      Data: getCategoryData.data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/check/category-name", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.check_category_name, req.body);
    if (errors) return res.status(400).json({ errors });

    const data = await service.checkCategoryNameExists(input.zodu_id, input.branch_id, input.category_name);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json({
      exists: data.exists,
      message: data.exists ? "Category name already exists" : "Category name is available",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/add/category", async (req, res) => {
  try {
    const { zodu_id, branch_id, name, type } = req.body;
    const data = await service.addCategoryData(zodu_id, branch_id, name, type);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category added successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/category/:id", owned.inPath("id", "tbl_category", "id"), async (req, res) => {
  try {
    const { name, type, zodu_id, branch_id } = req.body;
    const data = await service.updateCategoryData(req.params.id, name, type, zodu_id, branch_id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category updated successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/inactivate/category/:id", owned.inPath("id", "tbl_category", "id"), async (req, res) => {
  try {
    const { zodu_id, branch_id, active, page_expense } = req.body;
    const data = await service.InactivateCategory(req.params.id, zodu_id, branch_id, active, page_expense);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Status Updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.delete("/delete/category/:id/:branch_id/:zodu_id/:page_expense", owned.inPath("id", "tbl_category", "id"), async (req, res) => {
  try {
    const { id, zodu_id, branch_id, page_expense } = req.params;
    const data = await service.deleteCategoryData(id, branch_id, zodu_id, page_expense);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/delete/file/:name", async (req, res) => {
  try {
    const fileName = req.params.name;

    const result = await service.deleteFileFromMinIO(fileName, await attachments.uploadCtx(req));

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get("/get/pos_data/:branch_id/:zodu_id", async (req, res) => {
  try {
    const { branch_id, zodu_id } = req.params;
    const getPosData = await service.get_pos_data(branch_id, zodu_id);
    if (!getPosData.success) return res.status(400).json({ message: getPosData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getPosData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/get/units/:branch_id/:zodu_id", async (req, res) => {
  try {
    
    const data = await service.getUnits(req.params.branch_id, req.params.zodu_id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


// GST rates are one common list shared by every branch, so there are no tenant params.
router.get("/get/gst", async (req, res) => {
  try {
    const result = await service.getGST();

    if (!result.success)
      return res.status(400).json({ message: result.message });

    return res.status(200).json({
      message: "GST Data Fetch Success",
      data: result.data,
    });

  } catch (error) {
    console.error("GST GET Error", error);
    return res.status(500).json({ error: error.message });
  }
});


router.post("/add/hold_menu", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.holdSchema, req.body);
    if (errors) return res.status(400).json({ success: false, error: errors });

    const data = await service.addHoldMenu(input);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(201).json({ data });
  } catch (error) {
    console.error("Error adding hold:", error);
    res.status(500).json({ error: "Failed to save hold" });
  }
});

// ✅ :id is now hold_uuid
router.delete("/delete/hold-menu/:id", owned.inPath("id", "tbl_hold", "hold_uuid"), async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.deleteHoldMenu(id);
    if (!data.success) return res.status(400).json({ message: data.message });

    return res.status(200).json({ data });  // ✅ 200 for DELETE, not 201
  } catch (error) {
    console.error("Error deleting hold:", error);
    res.status(500).json({ error: "Failed to delete hold" });
  }
});

// ── Get holds for a branch (needed for POS recall) ────────────
router.get("/get/hold_menu/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { zodu_id, branch_id } = req.params;
    const data = await service.getHoldData(zodu_id, branch_id);
    return res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching holds:", error);
    res.status(500).json({ error: "Failed to fetch holds" });
  }
});


module.exports = router;
