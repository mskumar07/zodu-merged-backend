const express = require("express");
// const restaurantService = require("../service/restaurant-service");
const RequestValidator = require("../utils/requestValidator")
const schema = require("../schema/restaurant-schema");
const vSchema = require("../schema/validation-schema");
const service = require("../services/restaurant-service");
const branchService = require("../services/branch-service");
const multer = require("multer")
// Memory storage. Files go on to file-service (10MB per file) or are parsed here
// (Excel import); 25MB keeps a single request from holding hundreds of MB.
const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 },
});
const attachments = require("../utils/attachments");
const security = require("../security");
const owned = require("../security/owned");


const router = express.Router();

// zodu_id / branch_id in a path: the caller's company, a branch they may use.
security.protectParams(router);
// Record ids: the caller's company only.
router.param("cust_uuid", owned.param("tbl_customer", "cust_uuid"));
router.param("api_order_id", owned.param("tbl_orders", "api_order_id"));
router.param("menuId", owned.param("tbl_menu_items", "menu_id"));


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


// POST /api/add/orders moved to orders-controller


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

// GET /api/sales/:api_order_id?zodu_id=&branch_id=
router.get("/api/sales/data/get/:api_order_id", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sale_by_id_params, {
      api_order_id:   req.params.api_order_id,
      ...owned.recordOf(req, "tbl_orders"),
    });
    
    if (errors) return res.status(400).json({ errors });
 
    const data = await service.getSaleById(input.api_order_id, input.zodu_id, input.branch_id);
    if (!data.success) return res.status(404).json({ message: data.message });
 
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// Lines to put back in stock: items[].item_id is the menu_id.
router.delete("/api/sales/:api_order_id", owned.menuItems("items", "item_id"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sale_by_id_params, {
      api_order_id: req.params.api_order_id,
      ...owned.recordOf(req, "tbl_orders"),
    });

    if (errors) return res.status(400).json({ errors });

    const items = req.body?.items ?? [];
    const data = await service.deleteSale(
      input.api_order_id,
      input.zodu_id,
      input.branch_id,
      items
    );

    if (!data.success) return res.status(404).json({ message: data.message });

    return res.status(200).json({
      success: true,
      message: "Sale deleted successfully",
      data: data.data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
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
        ...owned.recordOf(req, "tbl_customer"),
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


router.post(
  "/api/add/vendor",
  async (req, res) => {
    try {
      const vendorData = req.body;

      const { errors, input } = await RequestValidator(
        schema.vendor_create,
        vendorData
      );

      if (errors) {
        return res.status(400).json({ errors });
      }

      const data = await service.createVendor(input);

      if (!data.success) {
        return res.status(400).json({ message: data.message });
      }

      return res.status(201).json({ data });
    } catch (error) {
      console.error(error);
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


router.put("/update/favorite/:favorite/:menuId", async (req, res) => {
  try {
    const { menuId, favorite } = req.params;
    const data = await service.updateMenuFav(menuId, favorite);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.put("/update/menustatus/:menu_status/:menuId", async (req, res) => {
  try {
    const { menuId, menu_status } = req.params;
    const data = await service.updateMenustaus(menuId, menu_status);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})


// PUT /api/update/inventory moved to inventory-controller

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

    const category_name = req.query.category_name?.trim() || undefined;

    const getCategoryData = await service.getAllCategoryData(types, branch_id, zodu_id, page, limit, category_name);
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

router.get("/category-name", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.category_name_check, req.query);
    if (errors) return res.status(400).json({ errors });

    const result = await service.checkCategoryNameExists(input.zodu_id, input.branch_id, input.name, input.type);
    if (!result.success) return res.status(400).json({ message: result.message });

    return res.status(200).json({
      message: result.exists ? "Category name already exists" : "Category name is available",
      exists: result.exists,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/add/category", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.category_create, req.body);
    if (errors) return res.status(400).json({ errors });
    const data = await service.addCategoryData(input.zodu_id, input.branch_id, input.name, input.type);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category added successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/category/:id", owned.inPath("id", "tbl_category", "id"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.category_update, req.body);
    if (errors) return res.status(400).json({ errors });
    const data = await service.updateCategoryData(req.params.id, input.name, input.type, input.zodu_id, input.branch_id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category updated successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/inactivate/category/:id", owned.inPath("id", "tbl_category", "id"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.category_inactivate, req.body);
    if (errors) return res.status(400).json({ errors });
    const data = await service.InactivateCategory(req.params.id, input.zodu_id, input.branch_id, input.active, input.page_expense);
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

// ─────────────────────────────────────────────────────────────
// KOT COUNTER (kitchen printer station) + item-to-counter assignment
// ─────────────────────────────────────────────────────────────


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


// GET /get/inventory-list/:branch_id moved to inventory-controller


router.get("/get/vendor/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getVendorData = await service.getVendorData(branch_id, req.tenant.zoduId);
    if (!getVendorData.success) return res.status(400).json({ message: getVendorData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getVendorData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /get/menu_item moved to menu-controller

router.get("/get/pos_data/:branch_id/:zodu_id", async (req, res) => {
  try {
    const { branch_id, zodu_id } = req.params;
    const { search } = req.query;
    const getPosData = await service.get_pos_data(branch_id, zodu_id, search);
    if (!getPosData.success) return res.status(400).json({ message: getPosData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getPosData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


// router.get("/get/pos_data/:branch_id", async (req, res) => {
//   try {
//     const { branch_id } = req.params
//     const getPosData = await service.get_pos_data(branch_id);
//     if (!getPosData.success) return res.status(400).json({ message: getPosData.message });
//     return res.status(201).json({ message: "Data Get Successfully", Data: getPosData.data });
//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({ error: error.message });
//   }
// });


// DELETE /delete/menu_item and PUT /update/menu_item moved to menu-controller

// GET /get/orders and GET /api/order moved to orders-controller


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

// ➤ ADD UNIT
router.post("/add/unit", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.unit_create, req.body);
    if (errors) return res.status(400).json({ errors });
    const data = await service.addUnit(input.zodu_id, input.branch_id, input.name, input.short_name);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Unit added successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ UPDATE UNIT
router.put("/update/unit/:id", owned.inPath("id", "tbl_units", "id"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.unit_update, req.body);
    if (errors) return res.status(400).json({ errors });
    const data = await service.updateUnit(req.params.id, input.name, input.short_name);
    return res.status(200).json({ message: "Unit updated successfully", data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ DELETE UNIT
router.delete("/delete/unit/:id/:branch_id", owned.inPath("id", "tbl_units", "id"), async (req, res) => {
  try {
    const result = await service.deleteUnit(req.params.id, req.params.branch_id);

    if (!result.success && result.used) {
      return res.status(200).json(result);  // Return usage info
    }

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/replace/unit", owned.inBody("old_unit_id", "tbl_units", "id"), owned.inBody("new_unit_id", "tbl_units", "id"), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.unit_replace, req.body);
    if (errors) return res.status(400).json({ errors });
    const result = await service.replaceUnit(input.old_unit_id, input.new_unit_id, input.branch_id);
    if (!result.success) return res.status(400).json({ message: result.message });
    return res.status(201).json({ message: "Unit replaced successfully", data: result.data });
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

router.post("/api/completeorder", owned.inBodyAny("api_order_id", [["tbl_tmp_orders", "api_order_id"], ["tbl_orders", "api_order_id"]]), owned.menuItems(), async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(vSchema.complete_order, req.body);
    if (errors) return res.status(400).json({ errors });
    const orderData = await service.update_Final_payment(input);
    if (!orderData.success) return res.status(400).json({ message: orderData.message });
    return res.status(201).json({ orderData });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
})


// POST /api/add/inventory moved to inventory-controller


module.exports = router;
