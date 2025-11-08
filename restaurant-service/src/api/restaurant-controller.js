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
const upload = multer(); // memory storage
const mime = require("mime-types");
const { DB_HOSTNAME, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY } = require("../config");


const router = express.Router();


// MinIO client
const minioClient = new Minio.Client({
  endPoint: "72.60.206.59", // e.g. 123.45.67.89
  port: 9000,
  useSSL: false,
  accessKey: "zoduminio",
  secretKey: "zodu@2025"
});

const bucketName = "zodu";


router.post("/api/createcompany", async (req, res) => {
  try {
    await conn.query('BEGIN');

    // Validate using the update schema (all fields optional)
    const { errors, input } = await RequestValidator(schema.company_create, req.body);
    if (errors) {
      await conn.query('ROLLBACK');
      console.log(req.body,errors)
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
    return res.status(201).json({ message : "Data Get Successfully" , Data: getData.data });
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
    return res.status(201).json({ message : "Data Inserted Successfully" , Data: data });
  } catch (error) {
    await conn.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});


router.post("/upload", upload.single("file"), async (req, res) => {
  try {
   const result =await service.uploadImg(req.file);
   return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.log(err)
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
      if (req.file) {
        menuData.menu_image = req.file; // multer stores file in req.file
      }
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

router.post(
  "/api/add/purchase_orders", upload.single("attachment_url"),
  async (req, res) => {
    try {
      const purchaseOrderData = req.body;

      console.log("test",purchaseOrderData)

      if (req.file) {
        purchaseOrderData.attachment_url = req.file; // multer stores file in req.file
      }
      purchaseOrderData.items = JSON.parse(purchaseOrderData.items);
     
      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.purchase_order_create,
        purchaseOrderData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      console.log(input)

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


      if (req.file) {
        expenseData.attachment_url = req.file; // multer stores file in req.file
      }
      expenseData.items = JSON.parse(expenseData.items);

      console.log(expenseData.items)
     
      await conn.query("BEGIN");
      const { errors, input } = await RequestValidator(
        schema.expense_data,
        expenseData
      );

      if (errors) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ errors });
      }

      const data = await service.createExpense(input);

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

router.put("/update/favorite/:favorite/:menuId",async (req,res)=>{
   try {
      const { menuId,favorite } = req.params;
    await conn.query('BEGIN');
    const data = await service.updateMenuFav(menuId,favorite);
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

router.put("/update/menustatus/:menu_status/:menuId",async (req,res)=>{
   try {
      const { menuId,menu_status } = req.params;
    await conn.query('BEGIN');
    const data = await service.updateMenustaus(menuId,menu_status);
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

router.put("/api/update/inventory",async (req,res)=>{
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

router.get("/get/category/:branch_id", async (req, res) => {
  
  try {
     const { branch_id } = req.params;
    const getCategoryData = await service.getCategoryData(branch_id);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getCategoryData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/expense-category/:branch_id", async (req, res) => {
  
  try {
     const { branch_id } = req.params;
    const getCategoryData = await service.getExpenseCategoryData(branch_id);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getCategoryData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/inventory-list/:branch_id", async (req, res) => {
  
  try {
    
     const { branch_id } = req.params;
     const type= req.query.type
    const getInventoryListData = await service.getInventoryListData(branch_id,type);
    if (!getInventoryListData.success) return res.status(400).json({ message: getInventoryListData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getInventoryListData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/purchase-list/:branch_id", async (req, res) => {
  
  try {
     const { branch_id } = req.params;
    const getPurchaseListData = await service.getPurchaseListData(branch_id);
    console.log(getPurchaseListData);
    if (!getPurchaseListData.success) return res.status(400).json({ message: getPurchaseListData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getPurchaseListData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/expense-list/:branch_id", async (req, res) => {
  
  try {
     const { branch_id } = req.params;
    const getExpenseListData = await service.getExpenseListData(branch_id);
    if (!getExpenseListData.success) return res.status(400).json({ message: getExpenseListData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getExpenseListData.data });
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
    return res.status(201).json({ message : "Data Get Successfully" , Data: getVendorData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/menu_item/:branch_id", async (req, res) => {

  try {
      const {branch_id} = req.params
    const getMenuItemData = await service.get_menuItem_data(branch_id);
    if (!getMenuItemData.success) return res.status(201).json({ message: getMenuItemData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getMenuItemData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/orders/:branch_id", async (req, res) => {

  try {

      const {branch_id} = req.params
    const getMenuItemData = await service.get_ordered_data(branch_id);
    if (!getMenuItemData.success) return res.status(400).json({ message: getMenuItemData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getMenuItemData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/api/completeorder",async (req,res)=>{
  try{
    const data = req.body
     const orderData = await service.update_Final_payment(data);

      if (!orderData.success) {
        await conn.query("ROLLBACK");
        return res.status(400).json({ message: orderData.message });
      }

      await conn.query("COMMIT");
      return res.status(201).json({ orderData });
  }catch(err){
    console.error(err)
    return res.status(500).json({error:err.message})
  }
})

router.get("/api/dashboard/:zodu_id/:branch_id",async (req, res) => {

  try {

      const {zodu_id, branch_id} = req.params
    const getData = await service.get_dashboard(zodu_id, branch_id);
    if (!getData.success) return res.status(400).json({ message: getData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
})

router.get("/api/report", async (req, res) => {
  // ✅ Validate query parameters
 const { errors, input } = await RequestValidator(
        schema.reportSchema,
        req.query
      );
  if (errors) {
    return res.status(400).json({ success: false, error: errors.details[0].message });
  }

  try {
    console.log("Report Query Params:", input);

    // ✅ Call service layer
    const data = await service.get_Report(input);

    return res.status(200).json({
      success: true,
      type: input.type,
      filter_used: input.filter,
      data,
    });
  } catch (err) {
    console.error("Error generating report:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
});

router.post("/api/add/inventory", async (req,res)=>{

  try{
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

  }catch(err){
    console.error("Inventory Update Failed",err.message)
    return res.status(500).json({
        success: false,
      message: err.message || "Internal server error",
    })
  }

})

router.post("/add/hold_menu", async (req, res) => {

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

module.exports = router;
