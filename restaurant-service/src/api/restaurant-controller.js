const express = require("express");
// const restaurantService = require("../service/restaurant-service");
const RequestValidator = require("../utils/requestValidator")
const schema = require("../schema/restaurant-schema");
const STATUS_CODES = require("../utils/error/status-codes");
const service = require("../services/restaurant-service");
const conn = require("../database/connection");
const Minio = require("minio");
const multer = require("multer")
const sharp = require("sharp")
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


// router.post("/api/add/menu_item", async (req, res) => {
//   try {
//     console.log(req.body)
//     await conn.query('BEGIN');
//     const { errors, input } = await RequestValidator(schema.menu_item_create, req.body);
//     if (errors) {
//       await conn.query('ROLLBACK');
//       return res.status(400).json({ errors });
//     }
//     const data = await service.createMenuItem(input);
//     if (!data.success) {
//       await conn.query('ROLLBACK');
//       return res.status(400).json({ message: data.message });
//     }
//     await conn.query('COMMIT');
//     return res.status(201).json({ data });
//   } catch (error) {
//     await conn.query('ROLLBACK');
//     console.error(error);
//     return res.status(500).json({ error: error.message });
//   }
// });

router.post(
  "/api/add/menu_item",
  upload.single("menu_image"), // key must match Postman
  async (req, res) => {
    try {
      const menuData = req.body;
      // Add file buffer to menuData for upload
      // if (req.file) {
      //   menuData.menu_image = req.file; // multer stores file in req.file
      // }
      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.menu_item_create,
        menuData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createMenuItem(input);

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


router.post(
  "/api/add/orders",
  async (req, res) => {
    try {
      console.log(req.body)
      const orderData = req.body;

      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.order_create,
        orderData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createOrder(input);

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
    if(!data.success){
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
    console.log("purchase",purchaseData);

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
      const result = await service.editPurchase( input);

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

router.post("/add/expense-item",async (req, res) => {
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

  }catch(error){
    await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
)

router.get("/get/expense-item/:branch_id",async (req, res) => {
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

router.put("/update/expense-item/:id/:branch_id",async (req, res) => {
    try{
      const { id,branch_id } = req.params
      const { name } = req.body
      const data =await service.editExpItem(id,branch_id,name)
      if(!data.success){
          await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
      }
    return res.status(201).json({ data });

    }catch(error){
 await conn.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: error.message });
    }
  })

router.delete("/delete/expense-item/:id",async (req, res) => {
  try{
    const {id} =req.params
    const data =await service.removeExpItem(id)
    if(!data.success){
                await conn.query("ROLLBACK");
      return res.status(500).json({ message: data.message });
      }
    return res.status(201).json({ data });

  }catch(error){
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
    if(!data.success){
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
    if(!data.success){
      await conn.query("ROLLBACK");
      return res.status(400).json({ message: data.message });
    }
return res.status(201).json({ data,message:"Purchase Deleted Successfully" });
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
     const { type,branch_id } = req.params;
    const getCategoryData = await service.getCategoryData(type,branch_id);
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
    const{id} = req.params
    const data = await service.updateExpenseCategory(name,id, branch_id)
    if(!data.success) return res.status(400).json({ message: data.message });
    return res.status(201).json({ message: "Data updated Successfully", Data: data.data });

  }catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

})

router.delete("/delete/expense-category/:id", async (req, res) => { 
  try {
    const { id } = req.params;
    console.log("delete",id)
    const data = await service.deleteExpenseCategory(id);
    if(!data.success) return res.status(400).json({message: data.message});
    return res.status(201).json({ message: "Data deleted Successfully", Data: data.data });

  }catch (error) {
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
    const {type,category} = req.query
    const getInventoryListData = await service.getInventoryListData(branch_id, type,category);
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

    console.log(req.body)
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

router.get("/api/dashboard/:zodu_id/:branch_id", async (req, res) => {

  try {

    const { zodu_id, branch_id } = req.params;

    // Extract query parameters for pagination
    const {
      page = 1,
      limit = 10,
      sortBy = "created_at",
      sortOrder = "desc"
    } = req.query;

    const getData = await service.get_dashboard(zodu_id, branch_id, {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder
    });

    if (!getData.success) return res.status(400).json({ message: getData.message });

    return res.status(200).json({
      message: "Data Get Successfully",
      data: getData.data,
      pagination: getData.pagination || {}
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
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
      summaryType = "all",   // all | category
      page = 1,
      limit = 30,
      sortBy = "order_date",
      sortOrder = "desc",
      top = 0,
       search = "" 
    } = req.query;


    const validTypes = ["restaurant", "orders", "purchase", "expense", "inventory"];
    const validFilters = ["today", "week", "month", "year", "custom"];
    const validSummaryTypes = ["all", "category"];  // ✅ only these two

    // Adjust sortBy for other types
    if (type === "purchase" && sortBy === "order_date") {
      sortBy = "purchase_date";
    }
    if (type === "expense" && sortBy === "order_date") {
      sortBy = "expense_date";
    }
    if (type === "inventory" && sortBy === "order_date") {
      sortBy = "created_at";
    }

    // Validate type
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid type. Must be restaurant, orders, purchase, expense, inventory.",
      });
    }

    // Validate summaryType
    if (!validSummaryTypes.includes(summaryType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid summaryType. Must be all or category.",
      });
    }

    // Validate date filter
    const validation = validateDateFilter(filterType, start_date, end_date);
    if (!validation.valid) {
      return res
        .status(400)
        .json({ success: false, message: validation.message });
    }

    // Map type → service fn
    const serviceMap = {
      orders: service.getOrdersSummary,
      purchase: service.getPurchaseSummary,
      expense: service.getExpenseSummary,
      inventory: service.getInventorySummary,
    };

    const getDataFn = serviceMap[type];

    const getData = await getDataFn(
      zodu_id,
      branch_id,
      filterType,
      start_date,
      end_date,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        sortBy,
        sortOrder,
        top: parseInt(top),
        summaryType,  
        search, 
      }
    );

    if (!getData?.success) {
      return res.status(400).json({
        success: false,
        message: getData?.message || "Failed to fetch data",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${type} summary fetched successfully`,
      data: getData.data,
      pagination: getData.pagination || {},
    });
  } catch (error) {
    console.error("Error in /api/report:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
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



module.exports = router;
