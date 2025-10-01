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
const { DB_HOSTNAME, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY } = require("../config");


const router = express.Router();


// MinIO client
const minioClient = new Minio.Client({
  endPoint: "69.62.72.83", // e.g. 123.45.67.89
  port: 9000,
  useSSL: false,
  accessKey: "admin",
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
    const file = req.file;
    let optimizedBuffer;
    let objectName;

    if (file.mimetype.startsWith("image/")) {
      // Convert everything to webp
      optimizedBuffer = await sharp(file.buffer)
        .resize({
          width: 1920,
          withoutEnlargement: true,
          fastShrinkOnLoad: true,
        })
        .webp({ quality: 80 })
        .toBuffer();

      objectName = Date.now() + "-" + file.originalname.split(".")[0] + ".webp";
    } else {
      optimizedBuffer = file.buffer;
      objectName = Date.now() + "-" + file.originalname;
    }

    // Upload to MinIO
    await minioClient.putObject(bucketName, objectName, optimizedBuffer, {
      "Content-Type": file.mimetype,
    });

    const fileurl=`http://69.62.72.83:8080/restaurant/file/${objectName}`

    // Construct public URL to access via GET /file/:name
    res.json({
      message: "✅ File uploaded & optimized",
      fileurl:fileurl,
      filename: objectName,
      sizeBefore: file.size,
      sizeAfter: optimizedBuffer.length,
    });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
});

router.get("/file/:name", async (req, res) => {
  try {
    const fileStream = await minioClient.getObject(bucketName, req.params.name);
    fileStream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: "File not found" });
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



router.get("/get/category/:branch_id", async (req, res) => {
  
  try {
     const { branch_id } = req.params;
    const getCategoryData = await service.getCategoryData(branch_id);
    console.log(getCategoryData);
    if (!getCategoryData.success) return res.status(400).json({ message: getCategoryData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getCategoryData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get/menu_item/:branch_id", async (req, res) => {

  try {
      const {branch_id} = req.params
    const getMenuItemData = await service.get_menuItem_data(branch_id);
    if (!getMenuItemData.success) return res.status(400).json({ message: getMenuItemData.message });
    return res.status(201).json({ message : "Data Get Successfully" , Data: getMenuItemData.data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
