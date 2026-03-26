const express = require("express");
// const restaurantService = require("../service/restaurant-service");
const RequestValidator = require("../utils/requestValidator")
const schema = require("../schema/restaurant-schema");
const STATUS_CODES = require("../utils/error/status-codes");
const service = require("../services/restaurant-service");
const conn = require("../database/connection");
const Minio = require("minio");
const multer = require("multer")
const repository = require('../repository/restaurant-repo.js');
const XLSX = require("xlsx");
const upload = multer({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});
// memory storage
const mime = require("mime-types");
const moment = require('moment/moment');
const { validateDateFilter } = require("../utils/Date_Folder/valaidator");
const { DB_HOSTNAME, MINIO_PORT, MINIO_ACCESSKEY, BUCKET_NAME, MINIO_SECRETKEY } = require("../config");


const router = express.Router();


// MinIO client
const minioClient = new Minio.Client({
  endPoint: DB_HOSTNAME, // e.g. 123.45.67.89
  port: MINIO_PORT,
  useSSL: false,
  accessKey: MINIO_ACCESSKEY,
  secretKey: MINIO_SECRETKEY
});

const bucketName = BUCKET_NAME;


router.post("/api/createcompany", async (req, res) => {
  try {
    await conn.query('BEGIN');

    // Validate using the update schema (all fields optional)
    const { errors, input } = await RequestValidator(schema.company_create, req.body);
    if (errors) {
      await conn.query('ROLLBACK');
      console.log(req.body, errors)
      return res.status(400).json({ errors });
    }

    // Call service to update company
    const data = await service.createCompanyService(input);
    if (!data.success) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ message: data.message });
    }

    await conn.query('COMMIT');
    return res.status(200).json({ success: true, data: data.data });

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ error: error.message });
  }
});



router.put("/api/company/:zodu_id", async (req, res) => {
  const { zodu_id } = req.params;

  try {
    await conn.query('BEGIN');

    // Validate using the update schema (all fields optional)
    const { errors, input } = await RequestValidator(schema.update_company, req.body);
    if (errors) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ errors });
    }

    // Call service to update company
    const data = await service.updateCompanyService(zodu_id, input);
    if (!data.success) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ message: data.message });
    }

    await conn.query('COMMIT');
    return res.status(200).json({ success: true, data: data.data });

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({ error: error.message });
  }
});


router.get("/get/company_details/:zudo_id", async (req, res) => {
  try {
    const { zudo_id } = req.params;
    const getData = await service.getData(zudo_id);
    if (!getData) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/add/branch", async (req, res) => {
  try {
    await conn.query('BEGIN');
    const { errors, input } = await RequestValidator(schema.branch_create, req.body);
    if (errors) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ errors });
    }
    const data = await service.createBranch(input);
    if (!data.success) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ message: data.message });
    }
    await conn.query('COMMIT');
    return res.status(201).json({ message: "Data Inserted Successfully", Data: data });
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    console.log(req.file)
    const result = await service.uploadImg(req.file);
    return res.status(200).json({ data: result });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
});

router.post("/upload/multiple", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const result = await service.uploadMultiple(req.files);


    return res.status(200).json({ success: true, files: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/file/:name", async (req, res) => {
  try {
    const fileName = req.params.name;
    const fileStream = await minioClient.getObject(bucketName, fileName);

    const contentType = mime.lookup(fileName) || "application/octet-stream";

    // Common inline preview types
    const inlineTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
    ];

    res.setHeader("Content-Type", contentType);

    // 🧠 Automatically decide inline vs download
    if (inlineTypes.includes(contentType)) {
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    }

    // Pipe file to client
    fileStream.pipe(res);
  } catch (err) {
    console.error("File fetch error:", err);
    if (err.code === "NoSuchKey") {
      return res.status(404).json({ error: "File not found" });
    }
    res.status(500).json({ error: "Failed to retrieve file" });
  }
});



router.post(
  "/api/add/product",
  upload.single("product_image"),
  async (req, res) => {
    try {
      const productData = req.body;

      await conn.query("BEGIN");

      const { errors, input } = await RequestValidator(
        schema.product_create,
        productData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createProduct(input);

      if (!data.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: data.message });
      }

      await conn.query("COMMIT");

      return res.status(201).json(data);
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);
const BATCH_SIZE = 1000;

router.post(
  "/api/products/upload-excel",
  upload.single("file"),
  async (req, res) => {
    const client = await conn.connect();

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);

      if (!data.length) {
        return res.status(400).json({ error: "Excel is empty" });
      }

      await client.query("BEGIN");

      let totalInserted = 0;

      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);

        const values = [];
        const placeholders = [];
        let index = 1;

        for (const item of batch) {
          if (!item.item_name || !item.zodu_id) continue;

          values.push(
            item.item_id || null,         // ✅ USER PROVIDED
            item.zodu_id || null,
            item.branch_id || null,
            item.item_type || "S",
            item.item_name || null,
            item.category_id || null,
            item.sku || null,
            item.barcode || null,
            item.hsn_code || null,
            item.unit || null,
            item.mrp || 0,
            item.sell_price || 0,
            item.purchase_price || 0,
            item.gst_type || 0,
            item.tax_incl_type ?? false,
            item.item_img || null
          );

          placeholders.push(
            `(
              gen_random_uuid(),  -- item_uuid
              $${index++}, $${index++}, $${index++}, $${index++},
              $${index++}, $${index++}, $${index++}, $${index++},
              $${index++}, $${index++}, $${index++}, $${index++},
              $${index++}, $${index++}, $${index++}, $${index++}
            )`
          );
        }

        if (!values.length) continue;

        const query = `
          INSERT INTO tbl_menu_items (
            item_uuid,
            item_id,
            zodu_id,
            branch_id,
            item_type,
            item_name,
            category_id,
            sku,
            barcode,
            hsn_code,
            unit,
            mrp,
            sell_price,
            purchase_price,
            gst_type,
            tax_incl_type,
            item_img
          )
          VALUES ${placeholders.join(",")}
          ON CONFLICT (barcode) DO NOTHING
        `;

        await client.query(query, values);
        totalInserted += placeholders.length;
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Products uploaded successfully",
        inserted: totalInserted
      });

    } catch (error) {
      await client.query("ROLLBACK");

      res.status(500).json({
        error: error.message
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/api/inventory/upload-excel",
  upload.single("file"),
  async (req, res) => {
    const client = await conn.connect();

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);

      if (!data.length) {
        return res.status(400).json({ error: "Excel is empty" });
      }

      await client.query("BEGIN");

      let totalProcessed = 0;

      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);

        const values = [];
        const placeholders = [];
        let index = 1;

        for (const item of batch) {
          if (
            !item.item_uuid ||
            !item.item_id ||
            !item.zodu_id ||
            !item.branch_id ||
            !item.item_name
          )
            continue;

          values.push(
            item.item_uuid,
            item.item_id,
            item.zodu_id,
            item.branch_id,
            item.item_name,
            item.available_qty || 0,
            item.reorder_level || 0
          );

          placeholders.push(
            `(
              gen_random_uuid(),
              $${index++}, $${index++}, $${index++}, $${index++},
              $${index++}, $${index++}, $${index++},
              CURRENT_TIMESTAMP
            )`
          );
        }

        if (!values.length) continue;

        const query = `
          INSERT INTO tbl_inventory (
            inventory_uuid,
            item_uuid,
            item_id,
            zodu_id,
            branch_id,
            item_name,
            available_qty,
            reorder_level,
            created_at
          )
          VALUES ${placeholders.join(",")}
          ON CONFLICT (item_uuid, branch_id)
          DO UPDATE SET
            item_id = EXCLUDED.item_id,
            item_name = EXCLUDED.item_name,
            available_qty = EXCLUDED.available_qty,
            reorder_level = EXCLUDED.reorder_level,
            last_stock_update = CURRENT_TIMESTAMP
        `;

        await client.query(query, values);
        totalProcessed += placeholders.length;
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Inventory uploaded successfully",
        processed: totalProcessed,
      });

    } catch (error) {
      await client.query("ROLLBACK");

      res.status(500).json({
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

router.put(
  "/api/edit/menu_item/:menu_id",
  upload.single("menu_image"), // optional image
  async (req, res) => {
    const menuId = req.params.menu_id;
    const menuData = req.body;

    try {
      await conn.query("BEGIN");

      // If image uploaded, attach file buffer
      // if (req.file) {
      //   menuData.menu_image = req.file;
      // }

      // Validate input using Joi schema for edit (we can reuse or create a new schema)
      const { errors, input } = await RequestValidator(
        schema.menu_item_update, // separate schema for update
        menuData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      // Call service to handle business logic and DB update
      const result = await service.editMenuItem(menuId, input);

      if (!result.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: result.message });
      }

      await conn.query("COMMIT");
      return res.status(200).json({ data: result.data });

    } catch (error) {
      await conn.query("ROLLBACK");
      console.error("Edit Menu Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);


router.post("/api/add/orders", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.order_create, req.body);
    console.log(req.body)
    if (errors) {
      console.log(errors)
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


router.put("/api/update/orders", async (req, res) => {
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
 
// GET /api/sales/:sale_id?zodu_id=&branch_id=
router.get("/api/sales/:sale_id", async (req, res) => {
  try {
    const { errors, input } = await RequestValidator(schema.sale_by_id_params, {
      sale_id:   req.params.sale_id,
      zodu_id:   req.query.zodu_id,
      branch_id: req.query.branch_id,
    });
    
    if (errors) return res.status(400).json({ errors });
 
    const data = await service.getSaleById(input.sale_id, input.zodu_id, input.branch_id);
    if (!data.success) return res.status(404).json({ message: data.message });
 
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.post("/api/sales/:sale_id/payment", async (req, res) => {
  try {
    const { error, value } = schema.mark_payment.validate(
      { ...req.body, sale_id: req.params.sale_id },
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
 
    // Normalise: single string mobile/email → array
    if (typeof value.mobile_no === "string") value.mobile_no = [value.mobile_no];
    if (typeof value.email_id  === "string") value.email_id  = [value.email_id];
 
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
 
// ── GET /api/customers/:cust_uuid
router.get("/api/customers/:cust_uuid", async (req, res) => {
  try {
    const { error, value } = schema.get_customer_by_id.validate(req.params, {
      abortEarly: false,
    });
 
    if (error) {
      return res.status(400).json({
        errors: error.details.map((d) => d.message),
      });
    }
 
    const data = await service.getCustomerById(value.cust_uuid);
 
    if (!data.success) {
      return res.status(404).json({ message: data.message });
    }
 
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  "/api/add/vendor",
  async (req, res) => {
    try {
      const vendorData = req.body;

      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.vendor_create,
        vendorData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createVendor(input);

      if (!data.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: data.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data });
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  "/api/edit/vendor",
  async (req, res) => {
    try {
      const vendorData = req.body;

      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.edit_vendor_create,
        vendorData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.editVendor(input);

      if (!data.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: data.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data });
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);


router.delete("/api/delete/vendor/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await conn.query("BEGIN");
    const data = await service.deleteVendor(id);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });

  }
}
);
router.post(
  "/api/add/purchase_orders", upload.array("attachment_url", 10),
  async (req, res) => {
    try {
      const purchaseOrderData = req.body;

      // if (req.files && req.files.length > 0) {
      //   purchaseOrderData.attachment_url = req.files.map(file => ({
      //     filename: file.originalname,
      //     mimetype: file.mimetype,
      //     path: file.path,
      //     size: file.size
      //   }));
      // }
      purchaseOrderData.items = typeof purchaseOrderData.items === "string" ? JSON.parse(purchaseOrderData.items) : purchaseOrderData.items;


      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.purchase_order_create,
        purchaseOrderData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }


      const data = await service.createPurchaseOrder(input);

      if (!data.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: data.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data });
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);


router.post(
  "/api/add/expense", upload.single("attachment_url"),
  async (req, res) => {
    try {
      const expenseData = req.body;

      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.expense_data,
        expenseData
      );
      console.log(input)

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createExpense(input);

      console.log(data)

      if (!data.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ data });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data });
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  "/api/edit/expense", upload.single("attachment_url"),
  async (req, res) => {
    const expenseData = req.body;


    try {
      await conn.query("BEGIN");
      // If attachment uploaded, attach file buffer
      // if (req.file) {
      //   expenseData.attachment_url = req.file;
      // }

      // Parse items if it's a string
      expenseData.total_amount = Number(expenseData.total_amount);
      expenseData.paid_amount = Number(expenseData.paid_amount);

      if (expenseData.items && typeof expenseData.items === 'string') {
        expenseData.items = JSON.parse(expenseData.items);
      }


      // Validate input using Joi schema for edit
      const { errors, input } = await RequestValidator(
        schema.expense_data_update,
        expenseData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      // Call service to handle business logic and DB update
      const result = await service.editExpense(input);

      if (!result.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: result.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data: result.data });

    } catch (error) {
      await conn.query("ROLLBACK");
      console.error("Edit Expense Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put(
  "/api/edit/purchase",
  async (req, res) => {
    const purchaseData = req.body;
    console.log("purchase", purchaseData);

    try {
      await conn.query("BEGIN");

      // If attachments uploaded, attach file buffers
      // if (req.files && req.files.length > 0) {
      //   purchaseData.attachment_url = req.files;
      // }

      // Parse items if it's a string
      purchaseData.total_amount = Number(purchaseData.total_amount);
      purchaseData.paid_amount = Number(purchaseData.paid_amount);

      if (purchaseData.items && typeof purchaseData.items === 'string') {
        purchaseData.items = JSON.parse(purchaseData.items);
      }

      // Validate input using Joi schema for edit
      const { errors, input } = await RequestValidator(
        schema.purchase_order_update,
        purchaseData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      // Call service to handle business logic and DB update
      const result = await service.editPurchase(input);

      if (!result.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: result.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ data: result.data });

    } catch (error) {
      await conn.query("ROLLBACK");
      console.error("Edit Purchase Error:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.put("/update/favorite/:favorite/:menuId", async (req, res) => {
  try {
    const { menuId, favorite } = req.params;
    await conn.query('BEGIN');
    const data = await service.updateMenuFav(menuId, favorite);
    if (!data.success) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ message: data.message });
    }
    await conn.query('COMMIT');
    return res.status(201).json({ data });
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.put("/update/menustatus/:menu_status/:menuId", async (req, res) => {
  try {
    const { menuId, menu_status } = req.params;
    await conn.query('BEGIN');
    const data = await service.updateMenustaus(menuId, menu_status);
    if (!data.success) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ message: data.message });
    }
    await conn.query('COMMIT');
    return res.status(201).json({ data });
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.post("/add/expense-item", async (req, res) => {
  try {
    const edata = req.body;
    await conn.query("BEGIN");
    const { errors, input } = await RequestValidator(
      schema.expense_item,
      edata
    );

    if (errors) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ errors });
    }
    const data = await service.createExpenseItem(input);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }

    await conn.query("COMMIT");
    return res.status(201).json({ data });

  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
)

router.get("/get/expense-item/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;
    const data = await service.getExpAllItems(branch_id);

    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(500).json({ message: data.message });
    }
    return res.status(201).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/expense-item/:id/:branch_id", async (req, res) => {
  try {
    const { id, branch_id } = req.params
    const { name } = req.body
    const data = await service.editExpItem(id, branch_id, name)
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });

  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.delete("/delete/expense-item/:id", async (req, res) => {
  try {
    const { id } = req.params
    const data = await service.removeExpItem(id)
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(500).json({ message: data.message });
    }
    return res.status(201).json({ data });

  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });

  }
})

router.delete("/api/delete/expense/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await conn.query("BEGIN");
    const data = await service.deleteExpense(id);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });

  }
}
);

router.delete("/api/delete/purchase/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await conn.query("BEGIN");
    const data = await service.deletePurchase(id);
    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data, message: "Purchase Deleted Successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });

  }
}
);
router.put("/api/update/inventory", async (req, res) => {
  try {
    console.log(req.body);
    const items = req.body;

    await conn.query("BEGIN");
    const { errors, input } = await RequestValidator(
      schema.inventorySchema,
      items
    );

    if (errors) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ errors });
    }

    const data = await service.update_Inventory(input);

    if (!data.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }

    await conn.query("COMMIT");
    return res.status(201).json({ data });
  } catch (error) {
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.get("/get/category/:type/:branch_id", async (req, res) => {

  try {
    const { type, branch_id } = req.params;
    const getCategoryData = await service.getCategoryData(type, branch_id);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getCategoryData.data });
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

router.put("/update/category/:id", async (req, res) => {
  try {
    const { name, type, branch_id } = req.body;
    const data = await service.updateCategoryData(req.params.id, name, type, branch_id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Category updated successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/delete/category/:id/:branch_id", async (req, res) => {
  try {
    const data = await service.deleteCategoryData(req.params.id, req.params.branch_id);
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

    const result = await service.deleteFileFromMinIO(fileName);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get("/get/expense-category/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getCategoryData = await service.getExpenseCategoryData(branch_id);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getCategoryData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/expense-category/:id", async (req, res) => {
  try {
    const { name, branch_id } = req.body;
    const { id } = req.params
    const data = await service.updateExpenseCategory(name, id, branch_id)
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data updated Successfully", Data: data.data });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

})

router.delete("/delete/expense-category/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("delete", id)
    const data = await service.deleteExpenseCategory(id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data deleted Successfully", Data: data.data });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
})



router.get("/get/purchase-category/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getCategoryData = await service.getPurchaseCategoryData(branch_id);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getCategoryData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/add/expense-category", async (req, res) => {
  try {
    const { zodu_id, branch_id, name } = req.body;
    const data = await service.addExpenseCategory(zodu_id, branch_id, name);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/get/inventory-list/:branch_id", async (req, res) => {

  try {

    const { branch_id } = req.params;
    const { type, category } = req.query
    const getInventoryListData = await service.getInventoryListData(branch_id, type, category);
    if (!getInventoryListData.success) return res.status(400).json({ message: getInventoryListData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getInventoryListData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/purchase-list/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;

    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      start_date = "",
      end_date = "",
      category_id = ""
    } = req.query;

    console.log(status)
    const getPurchaseListData = await service.getPurchaseListData(
      branch_id,
      page,
      limit,
      search,
      status,
      start_date,
      end_date,
      category_id
    );

    if (!getPurchaseListData.success)
      return res.status(400).json({ message: getPurchaseListData.message });

    return res.status(201).json({
      message: "Data Get Successfully",
      Data: getPurchaseListData.data,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/expense-list/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;
    const {
      page = 1,
      limit = 10,
      search = "",
      filter = "All",          // All | Paid | Unpaid
      start_date,
      end_date,
      category_id
    } = req.query;

    const data = await service.getExpenseListData({
      branch_id,
      page,
      limit,
      search,
      filter,
      start_date,
      end_date,
      category_id
    });

    if (!data.success)
      return res.status(400).json({ message: data.message });

    return res.status(200).json(data.data);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/purchase/:purchase_id", async (req, res) => {
  try {
    const { purchase_id } = req.params;
    const data = await service.getPurchaseById(purchase_id);
    if (!data.success)
      return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/expense-details/:expense_id", async (req, res) => {
  try {
    const { expense_id } = req.params;
    const data = await service.getExpenseDetails(expense_id);

    if (!data.success)
      return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});



router.get("/get/vendor/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getVendorData = await service.getVendorData(branch_id);
    if (!getVendorData.success) return res.status(400).json({ message: getVendorData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getVendorData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/menu_item/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { page = 1, limit = 10, search = "" } = req.query;

    const result = await service.get_menuItem_data(
      branch_id,
      page,
      limit,
      search
    );

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Data Get Successfully",
      pagination: result.pagination,   // <-- ADD THIS
      data: result.data                // <-- ADD THIS
    });

  } catch (error) {
    console.error("Get Menu API Error =>", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/pos_data/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params
    const getPosData = await service.get_pos_data(branch_id);
    if (!getPosData.success) return res.status(400).json({ message: getPosData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getPosData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.delete("/delete/menu_item/:id", async (req, res) => {
  try {
    const data = await service.deleteMenuItem(req.params.id);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Menu item deleted successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/update/menu_item/:id", async (req, res) => {
  try {
    const menuData = req.body;
    console.log("con", menuData)

    const data = await service.updateMenuItem(req.params.id, menuData);
    if (!data.success) return res.status(400).json({ message: data.message });
    console.log(data)
    return res.status(201).json({ message: "Menu item updated successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/orders/:branch_id", async (req, res) => {

  try {

    const { branch_id } = req.params
    const getMenuItemData = await service.get_ordered_data(branch_id);
    if (!getMenuItemData.success) return res.status(400).json({ message: getMenuItemData.message });
    return res.status(201).json({ message: "Data Get Successfully", Data: getMenuItemData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get(
  "/api/order/:zodu_id/:branch_id/:api_order_id",
  async (req, res) => {
    try {
      const { zodu_id, branch_id, api_order_id } = req.params;
      console.log("test",req.params)

      const result = await service.getSingleOrder(
        zodu_id,
        branch_id,
        api_order_id
      );

      return res.status(200).json({
        message: "Order fetched successfully",
        data: result
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
);


router.get("/get/units/:branch_id", async (req, res) => {
  try {
    const data = await service.getUnits(req.params.branch_id);
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
    const { zodu_id, branch_id, name, short_name } = req.body;
    const data = await service.addUnit(zodu_id, branch_id, name, short_name);
    if (!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Unit added successfully", data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ UPDATE UNIT
router.put("/update/unit/:id", async (req, res) => {
  try {
    const { name, short_name } = req.body;
    const data = await service.updateUnit(req.params.id, name, short_name);
    return success(res, "Unit updated successfully", data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ DELETE UNIT
router.delete("/delete/unit/:id/:branch_id", async (req, res) => {
  try {
    console.log(req.params)
    const result = await service.deleteUnit(req.params.id, req.params.branch_id);

    if (!result.success && result.used) {
      return res.status(200).json(result);  // Return usage info
    }

    return res.status(200).json(result);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/replace/unit", async (req, res) => {
  try {
    const { old_unit_id, new_unit_id, branch_id } = req.body;
    const result = await service.replaceUnit(old_unit_id, new_unit_id, branch_id);

    if (!result.success)
      return res.status(400).json({ message: result.message });

    return res.status(201).json({
      message: "Unit replaced successfully",
      data: result.data,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/gst/:branch_id", async (req, res) => {
  try {
    const { branch_id } = req.params;

    const result = await service.getGST(branch_id);

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

// ➤ ADD GST
router.post("/add/gst", async (req, res) => {
  try {
    const { zodu_id, branch_id, gst_rate } = req.body;

    const result = await service.addGST(
      zodu_id,
      branch_id,
      gst_rate
    );

    if (!result.success)
      return res.status(400).json({ message: result.message });

    return res.status(201).json({
      message: "GST Added Successfully",
      data: result.data,
    });

  } catch (error) {
    console.error("GST POST Error", error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ UPDATE GST
router.put("/update/gst/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { gst_rate } = req.body;

    const result = await service.updateGST(id, gst_rate);

    if (!result.success)
      return res.status(400).json({ message: result.message });

    return res.status(200).json({
      message: "GST Updated Successfully",
      data: result.data,
    });

  } catch (error) {
    console.error("GST UPDATE Error", error);
    return res.status(500).json({ error: error.message });
  }
});

// ➤ DELETE GST
router.delete("/delete/gst/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await service.deleteGST(id);

    if (!result.success)
      return res.status(400).json({ message: result.message });

    return res.status(200).json({
      message: "GST Deleted Successfully",
    });

  } catch (error) {
    console.error("GST DELETE Error", error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/api/completeorder", async (req, res) => {
  try {
    const data = req.body

    console.log("complete",req.body)
    const orderData = await service.update_Final_payment(data);

    if (!orderData.success) {
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: orderData.message });
    }

    await conn.query("COMMIT");
    return res.status(201).json({ orderData });
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message })
  }
})




router.post("/api/add/inventory", async (req, res) => {

  try {
    const { errors, input } = await RequestValidator(
      schema.Inventory,
      req.body
    );
    console.log(req.body)
    if (errors) {
      return res.status(400).json({ success: false, error: errors });
    }
    const data = await service.addin_Inventory(input);

    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }

    return res.status(201).json({ data });

  } catch (err) {
    console.error("Inventory Update Failed", err.message)
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    })
  }

});


router.get("/api/report/:type/:zodu_id/:branch_id", async (req, res) => {
  try {
    const { type, zodu_id, branch_id } = req.params;

    let {
      filterType = "year",
      start_date,
      end_date,
      page = 1,
      limit = 30,
      sortBy = "updated_at",
      sortOrder = "desc",
      search = "",
      reportView = "normal",
      year,
      stockFilter = "all" // ✅ ADD THIS
    } = req.query;

    const filterMap = {
      daily: "today",
      weekly: "week",
      monthly: "month",
      yearly: "year",
    };
    filterType = filterMap[filterType] || filterType;

    console.log(start_date,end_date,filterType)

    const serviceMap = {
      orders: service.getOrdersSummary,
      purchase: service.getPurchaseSummary,
      expense: service.getExpenseSummary,
      inventory: service.getInventorySummary,
    };

    year = year ? Number(year) : new Date().getFullYear();

    const result = await serviceMap[type](
      zodu_id,
      branch_id,
      filterType,
      start_date,
      end_date,
      {
        page: Number(page),
        limit: Number(limit),
        sortBy,
        sortOrder,
        search,
        reportView,
        year,
        stockFilter // ✅ PASS IT
      }
    );

    if (!result?.success) return res.status(400).json(result);

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination || {},
    });

  } catch (err) {
    console.error("REPORT ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/report/orders", async (req, res) => {
  try {
    const { filtered_type = "all_orders", zodu_id, branch_id, page = 1, limit = 10, start_date, end_date, year,search } = req.query;

    if (!zodu_id || !branch_id) {
      return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
    }

    // if (filtered_type === "date_wise" && (!start_date || !end_date)) {
    //   return res.status(400).json({ success: false, message: "start_date and end_date are required for date_wise filter" });
    // }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const result = await service.getReportServices(zodu_id, branch_id, pageNum, limitNum, filtered_type, start_date, end_date, year,search);

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    let response;

    if (filtered_type === "date_wise") {
      response = {
        success: true,
        datewise_summary: result.datewise_summary,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
        pagination: result.pagination,
      };
    } else if (filtered_type === "month_year_wise") {
      response = {
        success: true,
        monthly_summary: result.monthly_summary,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
      };
    } else {
      response = {
        success: true,
        all_orders: result.data,
        totalAmount: result.totalAmount,
        totalItems: result.totalItems,
        pagination: result.pagination,
      };
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("REPORT ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/report/purchase", async (req, res) => {
  try {
    const { filtered_type = "all_orders", zodu_id, branch_id, page = 1, limit = 10, start_date, end_date, year } = req.query;
    if (!zodu_id || !branch_id) {
      return res.status(400).json({ success: false, message: "zodu_id and branch_id are required" });
    }
    // if (filtered_type === "date_wise" && (!start_date || !end_date)) {
    //   return res.status(400).json({ success: false, message: "start_date and end_date are required for date_wise filter" });
    // }
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const result = await service.getPurchaseReportServices(zodu_id, branch_id, pageNum, limitNum, filtered_type, start_date, end_date, year);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    let response;
    const overallTotals = {
      over_all_purchase: result.over_all_purchase,
      over_all_total_amount: result.totalAmount,
      over_all_total_paid: result.totalPaid,
      over_all_total_due: result.totalDue,
    };
    if (filtered_type === "date_wise") {
      response = {
        success: true,
        datewise_summary: result.datewise_summary,
        ...overallTotals,
        pagination: result.pagination,
      };
    } else if (filtered_type === "month_year_wise") {
      response = {
        success: true,
        monthly_summary: result.monthly_summary,
        ...overallTotals,
      };
    } else {
      response = {
        success: true,
        all_orders: result.data,
        ...overallTotals,
        pagination: result.pagination,
      };
    }
    return res.status(200).json(response);
  } catch (err) {
    console.error("REPORT ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/get/report/order-category", async (req, res) => {
  try {
    const {
      zodu_id,
      branch_id,
      page = 1,
      limit = 10,
      search = ""   // ✅ correct param
    } = req.query;

    const data = await service.getReportCategory(
      zodu_id,
      branch_id,
      Number(page),
      Number(limit),
      search
    );

    if (!data.success)
      return res.status(400).json({ message: data.message });

    return res.status(200).json({
      message: "Data Get Successfully",
      summary: data.summary,
      pagination: data.pagination,
      Data: data.data
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.get("/api/report/expense", async (req, res) => {
  try {
    const {
      filtered_type = "all_expense",
      zodu_id,
      branch_id,
      page = 1,
      limit = 10,
      start_date,
      end_date,
      year
    } = req.query;

    if (!zodu_id || !branch_id) {
      return res.status(400).json({
        success: false,
        message: "zodu_id and branch_id are required"
      });
    }

    // if (filtered_type === "date_wise" && (!start_date || !end_date)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "start_date and end_date are required for date_wise filter"
    //   });
    // }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const result = await service.getExpenseReportServices(
      zodu_id,
      branch_id,
      pageNum,
      limitNum,
      filtered_type,
      start_date,
      end_date,
      year
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    let response;

    /* ================= DATE WISE ================= */
    if (filtered_type === "date_wise") {
      response = {
        success: true,
        datewise_summary: result.datewise_summary,
        totalBills: result.totalBills,
        totalAmount: result.totalAmount,
        totalPaid: result.totalPaid,
        totalUnpaid: result.totalUnpaid,
        totalItems: result.totalItems,
        pagination: result.pagination
      };
    }

    /* ================= MONTH / YEAR WISE ================= */
    else if (filtered_type === "month_year_wise") {
      response = {
        success: true,
        monthly_summary: result.monthly_summary,
        totalBills: result.totalBills,
        totalAmount: result.totalAmount,
        totalPaid: result.totalPaid,
        totalUnpaid: result.totalUnpaid,
        totalItems: result.totalItems
      };
    }

    /* ================= ALL EXPENSE LIST ================= */
    else {
      response = {
        success: true,
        all_orders: result.data,
        totalBills: result.totalBills,
        totalAmount: result.totalAmount,
        totalPaid: result.totalPaid,
        totalUnpaid: result.totalUnpaid,
        totalItems: result.totalItems,
        pagination: result.pagination
      };
    }

    return res.status(200).json(response);

  } catch (err) {
    console.error("REPORT ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});



router.get("/get/purchase/:purchase_id", async (req, res) => {
  try {
    const { purchase_id } = req.params;
    const data = await service.getPurchaseById(purchase_id);
    if (!data.success)
      return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/expense/:expense_id", async (req, res) => {
  try {
    const { expense_id } = req.params;
    const data = await service.getExpenseById(expense_id);

    if (!data.success)
      return res.status(400).json({ message: data.message });
    return res.status(200).json({ message: "Data Get Successfully", Data: data.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.post("/add/hold_menu", async (req, res) => {
  console.log(req.body)
  try {
    const { errors, input } = await RequestValidator(
      schema.holdSchema,
      req.body
    );
    if (errors) {
      return res.status(400).json({ success: false, error: errors });
    }
    const data = await service.addHoldMenu(input);

    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }

    return res.status(201).json({ data });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding hold:", error);
    res.status(500).json({ error: "Failed to save hold" });
  }
});

router.delete("/delete/hold-menu/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await service.deleteHoldMenu(id);
    if (!data.success) {
      return res.status(400).json({ message: data.message });
    }
    return res.status(201).json({ data });
  } catch (error) {
    console.error("Error deleting hold:", error);
    res.status(500).json({ error: "Failed to delete hold" });
  }
});

router.get("/get/hold-orders/:branch_id", async (req, res) => {

  try {
    const { branch_id } = req.params;
    const getHoldData = await service.getHoldData(branch_id);
    if (!getHoldData.success) return res.status(400).json({ message: getHoldData.message });
    return res.status(201).json({ message: "Holds fetched successfully", Data: getHoldData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payment/pay
router.post("/api/payment/pay", async (req, res) => {
  try {
    const result = await service.makePayment(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/payments/add", async (req, res) => {
  try {

    const result = await service.markSalePayment(req.body);

    return res.status(200).json(result);

  } catch (error) {

    console.error("Payment Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add payment",
    });
  }
});

module.exports = router;
