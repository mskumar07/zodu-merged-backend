const multer = require('multer');
const { consumeEvents } = require('../consumer/consumer');
const Minio = require("minio");
const sharp = require("sharp");
const repository = require('../repository/restaurant-repo.js');
const { PDFDocument } = require('pdf-lib');
const moment = require('moment/moment');



const minioClient = new Minio.Client({
  endPoint: "72.60.206.59", // e.g. 123.45.67.89
  port: 9000,
  useSSL: false,
  accessKey: "zoduminio",
  secretKey: "zodu@2025"
});

const bucketName = "zodu";

async function createCompanyService(companyData) {
  // 1. Validate data using Joi schema
  try {
    // const duplicateFields = [];
    // const fieldsToCheck = ["mobile_no", "gst_no", "mail_id"];
    // for (const field of fieldsToCheck) {
    //   if (companyData[field]) {
    //     const result = await repository.FindExistingData("tbl_company_registration", field, companyData[field]);
    //     if (result.rows.length > 0) {
    //       duplicateFields.push(field);
    //     }
    //   }
    // }
    // if (duplicateFields.length > 0) {
    //   return {
    //     success: false,
    //     message: `${duplicateFields.join(", ")} Already Exists`,
    //   };
    // }
    // const checkMaxZoduID = await repository.findMaxZoduId();
    // let newZoduId = "ZODU001"; // default for first record    

    // if (checkMaxZoduID.rows[0].max) {
    //   const maxZoduId = checkMaxZoduID.rows[0].max; // e.g., "ZODU001"
    //   const numPart = parseInt(maxZoduId.replace("ZODU", ""), 10); // 1
    //   const nextNum = numPart + 1; // 2
    //   newZoduId = "ZODU" + String(nextNum).padStart(3, "0"); // ZODU002
    // }
    // companyData.zodu_id = newZoduId;
    const company = await repository.createCompany(companyData);
    return {
      success: true,
      message: "Company updated successfully",
      data: company,
    };
  } catch (err) {
    console.error("Error inserting company:", err);
    return {
      success: false,
      message: err.message
    };
  }
}

async function uploadImg(file) {
  console.log(file)
  try {
    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB limit

    if (!file || !file.buffer || file.size === 0) {
      throw new Error("Invalid file input or empty file");
    }

    if (file.size > MAX_SIZE) {
      throw new Error("File size exceeds 5MB limit");
    }

    const originalExt = file.originalname.split(".").pop().toLowerCase();
    const baseName = file.originalname.replace(/\.[^/.]+$/, "");
    let optimizedBuffer;
    let objectName;

    // 🖼️ Image optimization
    if (file.mimetype.startsWith("image/")) {
      // Optional: keep original format
      const format = originalExt === "png" || originalExt === "jpg" || originalExt === "jpeg"
        ? originalExt
        : "webp";

      optimizedBuffer = await sharp(file.buffer)
        .resize({ width: 1920, withoutEnlargement: true, fastShrinkOnLoad: true })
        .toFormat(format, { quality: 80 })
        .toBuffer();

      objectName = `${Date.now()}-${baseName}.${format}`;
    }
    // 📄 PDF optimization
    else if (originalExt === "pdf") {
      const pdfDoc = await PDFDocument.load(file.buffer);
      const compressedPdf = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
      optimizedBuffer = Buffer.from(compressedPdf);
      objectName = `${Date.now()}-${file.originalname}`;
    }
    // 📃 Other files (no processing)
    else {
      optimizedBuffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
      objectName = `${Date.now()}-${file.originalname}`;
    }

    if (!Buffer.isBuffer(optimizedBuffer)) {
      throw new Error("File data is not a valid Buffer");
    }

    // ✅ Upload to MinIO
    await minioClient.putObject(
      bucketName,
      objectName,
      optimizedBuffer,
      optimizedBuffer.length,
      { "Content-Type": file.mimetype }
    );

    const fileUrl = `https://api.zodusolutions.cloud/restaurant/file/${objectName}`;
    console.log("✅ File uploaded successfully:", fileUrl);
    return fileUrl;

  } catch (err) {
    console.error("Upload failed:", err);
    return { success: false, error: err.message };
  }
}

async function updateCompanyService(zodu_id, updateData) {
  try {
    // Check if company exists
    const existing = await repository.getCompanyByZoduId(zodu_id);
    if (!existing) return { success: false, message: "Company not found" };

    const updated = await repository.updateCompany(zodu_id, updateData);
    return { success: true, data: updated };
  } catch (err) {
    console.error("Error updating company:", err);
    return { success: false, message: err.message };
  }
}


async function updateMenuFav(menu_id,favorite){
  try{
    const updateFav = await repository.updateFavorite(menu_id,favorite)
    return {success:true, data: updateFav}

  }catch (err){
     console.error("Error updating Menu:", err);
    return { success: false, message: err.message };
  }
}

async function updateMenustaus(menu_id,active){
  try{
    const updatestatus = await repository.updateActive(menu_id,active)
    return {success:true, data: updatestatus}

  }catch (err){
     console.error("Error updating Menu:", err);
    return { success: false, message: err.message };
  }
}

async function getData(zudo_id) {
  try {
    zudo_id = "ZODU001"; // Default for testing
    // Fetch company details
    const SingleCompanyData = await repository.FindExistingData("tbl_company_registration", 'zodu_id', zudo_id);
    return {
      success: true,
      data: SingleCompanyData.rows,
    };
  } catch (error) {
    console.error("Company Data Getting Error", error);
    return {
      success: false,
      message: err.message
    };
  }
}

async function getCategoryData(branch_id) {
  try {
    const allCategoryData = await repository.get_category_data(branch_id);
    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: err.message
    };
  }
}

async function get_Report(data) {
  try{
    const ReportData= await repository.getReport(data)
 return {
      success: true,
      data: ReportData,
    };
  }catch(error){
    console.error("Report error",error);
    return {
      success: false,
      message: err.message
    };
  }
  
}

async function get_dashboard(zodu_id,branch_id) {
   try{
    const DashboardData = await repository.getDashboard(zodu_id,branch_id)
 return {
      success: true,
      data: DashboardData,
    };
  }catch(error){
    console.error("Report error",error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function getRestaurantSummary(zodu_id, branch_id, filterType, start_date, end_date) {
  try {
    let startDate, endDate;

    switch (filterType) {
      case "today":
        startDate = moment().startOf("day");
        endDate = moment().endOf("day");
        break;
      case "week":
        startDate = moment().startOf("week");
        endDate = moment().endOf("week");
        break;
      case "month":
        startDate = moment().startOf("month");
        endDate = moment().endOf("month");
        break;
      case "year":
        startDate = moment().startOf("year");
        endDate = moment().endOf("year");
        break;
      case "custom":
        startDate = moment(start_date).startOf("day");
        endDate = moment(end_date).endOf("day");
        break;
      default:
        // Last 7 days
        startDate = moment().subtract(6, "days").startOf("day");
        endDate = moment().endOf("day");
    }

    if (!startDate || !endDate) {
      throw new Error("Date range not calculated properly");
    }

    // Call repository
    const reportData = await repository.getRestaurantSummary(
      zodu_id,
      branch_id,
      startDate.format("YYYY-MM-DD"),
      endDate.format("YYYY-MM-DD")
    );

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Summary fetched successfully",
      dateRange: {
        start: startDate.format("YYYY-MM-DD"),
        end: endDate.format("YYYY-MM-DD"),
        filterType: filterType || "last_7_days",
      },
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getRestaurantSummary):", error);
    return {
      success: false,
      message: error.message || "Unable to fetch restaurant summary",
    };
  }
}


async function getVendorData(branch_id) {
  try {
    const allVendorData = await repository.getVendor(branch_id); 
    return {
      success: true,
      data: allVendorData,
    };
  } catch (error) {
    console.error("Vendor Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function getInventoryListData(branch_id,type) {
  try {
    const allInventoryData = await repository.get_inventory_list(branch_id,type);
    return {
      success: true,
      data: allInventoryData,
    };
  } catch (error) {
    console.error("Inventory Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function addin_Inventory(data) {

  try{
     const CategoryCreate = await repository.createCategory(
      data.zodu_id,
      data.branch_id,
      data.category
    );
    data.category = CategoryCreate.id;
    const InventoryData = await repository.addin_Inventory(data)
    return{
      success:true,
      data:InventoryData
    }

  }catch(err){
    console.error("Inventory Update Failed",err);
     return {
      success: false,
      message: err.message
    };
  }
}

async function getPurchaseListData(branch_id) {
  try {
    const allPurchaseData = await repository.get_purchase(branch_id);
    return {
      success: true,
      data: allPurchaseData,
    };
  } catch (error) {
    console.error("Purchase Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function getExpenseListData(branch_id) {
  try {
    const allExpenseData = await repository.get_Expense(branch_id);
    return {
      success: true,
      data: allExpenseData,
    };
  } catch (error) {
    console.error("Purchase Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}
// async function get_menuItem_data(branch_id) {
//   try {
//     const allMenuItemData = await repository.get_menuItem_data(branch_id);
//     console.log(allMenuItemData.rows)
//     return {
//       success: true,
//       data: allMenuItemData.rows,
//     };
//   } catch (error) {
//     console.error("Menu Item Data getting Error", error);
//     return {
//       success: false,
//       message: error.message
//     };
//   }
// }

async function update_Inventory(data){
  try{
 const updatedInventory = await repository.updateInventory(data)
    return {success:true, data: updatedInventory}
    
  }catch(error){
    console.error("Menu Item Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

async function get_menuItem_data(branch_id) {
  try {
    const allMenuItemData = await repository.get_menuItem_data(branch_id);
    // ✅ Ensure structure is categories with items
    const categories = (allMenuItemData.rows || []).map((category) => {
      const items = (category.items || []).map((item) => {
        let variants = item.variants;

        try {
          if (typeof variants === "string") {
            variants = JSON.parse(variants);
          }
        } catch (err) {
          console.warn(`Invalid JSON in variants for menu_id ${item.menu_id}`, err);
          variants = []; // fallback
        }

        return {
          ...item,
          variants,
        };
      });

      return {
        ...category,
        items,
      };
    });

    return {
      success: true,
      data: categories,
    };
  } catch (error) {
    console.error("Menu Item Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}


async function get_ordered_data(data) {
  try {
    const orderData = await repository.get_ordered_data(data);

    return {
      success: true,
      data: orderData,
    };
  } catch (error) {
    console.error("update Order Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

async function update_Final_payment(data) {
   try {
    const orderData = await repository.updateFinalPayment(data);

    return {
      success: true,
      data: orderData,
    };
  } catch (error) {
    console.error("Menu Item Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}


async function createBranch(branchData) {
  try {
    const duplicateFields = [];
    const fieldsToCheck = ["branch_mobile_no", "branch_mail_id"];

    // Check existing data for given fields
    for (const field of fieldsToCheck) {
      if (branchData[field]) {
        const result = await repository.FindExistingData("tbl_resturant_branch", field, branchData[field]);

        if (result.rows.length > 0) {
          // Check if any record has same field but different zodu_id
          const sameCompanyDetails = result.rows.find(row => row.zodu_id === branchData.zodu_id);
          if (!sameCompanyDetails) {
            duplicateFields.push(field);
          }
        }
      }
    }
    // If duplicates found → return error
    if (duplicateFields.length > 0) {
      return {
        success: false,
        message: `${duplicateFields.join(", ")} already exists`,
      };
    }
    // Generate new zodu_id if not provided
    let BranchId = await repository.findMaxBranchID(branchData.zodu_id);
    console.log("BranchId", BranchId.rows);
    if (BranchId.rows[0].max === null || BranchId.rows[0].max === undefined) { 
      branchData.branch_id = branchData.zodu_id + "B1";
      console.log("first branch id", branchData.branch_id);
    }
    else if (BranchId.rows[0].max) {
      console.log("Not first branch id", BranchId.rows[0].max);
      const maxBranchId = BranchId.rows[0].max; 
      const match = maxBranchId.match(/B(\d+)$/);
      const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
      branchData.branch_id = maxBranchId.replace(/B\d+$/, "B" + nextNum);
      console.log("New Branch ID:", branchData.branch_id);
    }
    const branch = await repository.createBranch(branchData);

    return {
      success: true,
      message: "Branch created successfully",
      data: branch,
    };
  } catch (err) {
    console.error("Error inserting branch:", err);
    return {
      success: false,
      message: err.message
    };
  }
}


// async function createMenuItem(menuData) {
//   try {
//     const CreateQr = await repository.createQRCode(menuData.item_code);
//     menuData.qr_code_id = CreateQr.id;

//     const CategoryCreate = await repository.createCategory(menuData.zodu_id, menuData.branch_id, menuData.menu_category);
//     console.log("CategoryCreate:", CategoryCreate);

//     menuData.menu_category_id = CategoryCreate.id;

//     console.log("MenuData in Service:", menuData);
//     const newMenu = await repository.createMenuItem(menuData);
//     return {
//       success: true,
//       message: 'Menu item created successfully',
//       data: newMenu
//     };
//   } catch (err) {
//     console.error("Error inserting menu item:", err);
//     return {
//       success: false,
//       message: err.message
//     };
//   }
// }

async function createMenuItem(menuData) {
  try {
    
    const CreateQr = await repository.createQRCode(menuData.item_code);
    menuData.qr_code_id = CreateQr.id;

    if(menuData.menu_image){
      const imgResult = await uploadImg(menuData.menu_image);
      menuData.menu_image = imgResult;
    }

    const CategoryCreate = await repository.createCategory(
      menuData.zodu_id,
      menuData.branch_id,
      menuData.menu_category
    );
    menuData.menu_category_id = CategoryCreate.id;

    // Generate safe sequential menu_id (no extra table needed)
    const nextNumber = await repository.getNextMenuId(
      menuData.zodu_id,
      menuData.branch_id
    );
    menuData.menu_id = `${menuData.zodu_id}-${menuData.branch_id}-${nextNumber}`;
    console.log(nextNumber)
    menuData.menu_code=menuData.item_code
    menuData.favorites=false

    const newMenu = await repository.createMenuItem(menuData);

    return {
      success: true,
      message: "Menu item created successfully",
      data: newMenu,
    };
  } catch (err) {
    console.error("Error inserting menu item:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}

async function createOrder(orderData) {

  try {

     if (!orderData.order_id || orderData.order_id.trim() === "" || orderData.order_id === "null") {
      const nextOrderId = await repository.getNextOrderId(orderData.branch_id);
      orderData.order_id = `${orderData.branch_id}-O${nextOrderId}`;
    }

const newOrder = await repository.createOrder(orderData);
const neworderItem=await repository.createOrderedItems(orderData);
const newKot = await repository.createKOT(orderData);

return {
      success: true,
      message: "Order created successfully",
      data: {newOrder,neworderItem,newKot},
    };
  }catch(err){
     console.error("Error inserting Order:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}

async function createVendor(vendorData) {
  try {

    const newVendor = await repository.createnewVendor(vendorData);
    return {
      success: true,
      message: "Vendor created successfully",
      data: newVendor,
    };
  } catch (err) {
    console.error("Error inserting Vendor:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}

async function createPurchaseOrder(purchaseOrderData) {
  try {
    // ✅ Step 1: Create category
    const CategoryCreate = await repository.createCategory(
      purchaseOrderData.zodu_id,
      purchaseOrderData.branch_id,
      purchaseOrderData.category
    );
    purchaseOrderData.category = CategoryCreate.id;

    // ✅ Step 2: Get vendor ID
    const getVendor = await repository.getVendorId(
      purchaseOrderData.zodu_id,
      purchaseOrderData.branch_id,
      purchaseOrderData.vendor
    );
    purchaseOrderData.vendor = getVendor.vendor_id;

    // ✅ Step 3: Upload image (Stop if fails)
    const imgResult = await uploadImg(purchaseOrderData.attachment_url);
    if (!imgResult.success) {
      // ❌ Stop execution and throw error with the image upload message
      throw new Error(imgResult.message || "Image upload failed");
    }
    purchaseOrderData.attachment_url = imgResult.url; // assuming uploadImg returns { success, url, message }

    // ✅ Step 4: Generate Purchase ID
    const nextPurchaseId = await repository.getNextPurchaseId(purchaseOrderData.branch_id);
    purchaseOrderData.purchase_id = `${purchaseOrderData.branch_id}-PO${nextPurchaseId}`;

    // ✅ Step 5: Create purchase order and related data
    await repository.createPurchaseOrder(purchaseOrderData);
    await repository.insertPurchaseItems(purchaseOrderData.purchase_id, purchaseOrderData.items);

    await repository.addInventory(
      purchaseOrderData.items,
      purchaseOrderData.branch_id,
      purchaseOrderData.zodu_id,
      purchaseOrderData.purchase_date,
      purchaseOrderData.category,
      purchaseOrderData.purchase_type // include purchase_type for inventory_type logic
    );

    await repository.addExpense(purchaseOrderData);

    return {
      success: true,
      message: "Purchase order created successfully",
    };
  } catch (err) {
    console.error("Error inserting Purchase Order:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}


async function createExpense(expenseData) {
  try {
      const CategoryCreate = await repository.createCategory(
      expenseData.zodu_id,
      expenseData.branch_id,
      expenseData.category
    );
    expenseData.category = CategoryCreate.id;
      const imgResult = await uploadImg(expenseData.attachment_url);
    expenseData.attachment_url = imgResult;
    await repository.addExpense(expenseData);

    return {
      success: true,
      message: "Purchase order created successfully",
    };
  } catch (err) {
    console.error("Error inserting Purchase Order:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}

// Export all functions
module.exports = {
  createCompanyService,
  getData,
  createBranch,
  createMenuItem,
  getCategoryData,
  get_menuItem_data,
  updateCompanyService,
  uploadImg,
  updateMenuFav,
  updateMenustaus,
  createOrder,
  get_ordered_data,
  createPurchaseOrder,
  createVendor,
  getVendorData,
  getInventoryListData,
  getPurchaseListData,
  getExpenseListData,
  createExpense,
  update_Inventory,
  get_Report,
  addin_Inventory,
  update_Final_payment,
  get_dashboard,
  getRestaurantSummary
};
