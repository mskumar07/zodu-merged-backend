const multer = require('multer');
const { consumeEvents } = require('../consumer/consumer');
const Minio = require("minio");
const sharp = require("sharp");

const repository = require('../repository/restaurant-repo.js');
const { PDFDocument } = require('pdf-lib');
const moment = require('moment/moment');
const { DB_HOSTNAME, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME } = require('../config/index.js');
const { getDateRange } = require("../utils/Date_Folder/getDate.js");
const { get } = require('../api/restaurant-controller.js');



const minioClient = new Minio.Client({
  endPoint: DB_HOSTNAME, // e.g. 123.45.67.89
  port: MINIO_PORT,
  useSSL: false,
  accessKey: MINIO_ACCESSKEY,
  secretKey: MINIO_SECRETKEY
});

const bucketName = BUCKET_NAME;

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
  try {
    if (!file || !file.buffer)
      throw new Error("Invalid file input");

    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

    if (file.size > MAX_SIZE)
      throw new Error("File exceeds 10MB limit");

    const ext = file.originalname.split(".").pop().toLowerCase();

    let buffer = file.buffer;
    let outputName = `${Date.now()}-${file.originalname}`;

    // ✔ Optimize only images
    if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
      buffer = await sharp(file.buffer)
        .resize({ width: 1800, withoutEnlargement: true })
        .toFormat("webp", { quality: 80 })
        .toBuffer();

      outputName = `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "")}.webp`;
    }

    // ✔ PDFs (compress)
    else if (ext === "pdf") {
      const pdfDoc = await PDFDocument.load(file.buffer);
      const compressed = await pdfDoc.save({ useObjectStreams: true });
      buffer = Buffer.from(compressed);
    }

    // ✔ OFFICE DOCS, CSV, TXT — do not modify
    else {
      buffer = Buffer.from(file.buffer);
    }

    // Upload to MinIO
    await minioClient.putObject(
      bucketName,
      outputName,
      buffer,
      buffer.length,
      { "Content-Type": file.mimetype }
    );

    const url = `https://api.zodusolutions.cloud/restaurant/file/${outputName}`;

    return { success: true, fileUrl: url };

  } catch (err) {
    console.error("Upload failed:", err);
    return { success: false, message: err.message };
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


async function updateMenuFav(menu_id, favorite) {
  try {
    const updateFav = await repository.updateFavorite(menu_id, favorite)
    return { success: true, data: updateFav }

  } catch (err) {
    console.error("Error updating Menu:", err);
    return { success: false, message: err.message };
  }
}

async function uploadMultiple(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files received");
  }

  const results = [];

  for (const file of files) {
    // Validate file
    if (!file || !file.buffer) {
      throw new Error("Invalid file received");
    }

    const uploaded = await uploadImg(file);

    if (!uploaded.success) {
      throw new Error(uploaded.message || "One or more file uploads failed");
    }

    results.push({
      id: Date.now() + "-" + Math.floor(Math.random() * 1000000),
      filename: file.originalname || `file-${Date.now()}`, // safe fallback
      url: uploaded.fileUrl,
      size: file.size || 0,
      mimetype: file.mimetype ?? "application/octet-stream",
    });
  }

  return results;
}


async function createExpenseItem (input) {
  try {
   
    const data = await repository.createItem(input);
    return {success:true,data:data}
  } catch (error) {
 console.error( error);
    return { success: false, message: error.message };  }
};

async function getExpAllItems (branch_id)  {
  try {
    const data = await repository.getItems(branch_id);

  
    return {success:true,data:data}
  } catch (error) {
console.error( error);
    return { success: false, message: error.message };  }  
};

// Update Item
async function editExpItem (id,branch_id,name)  {
  try {
   

    const updated = await repository.updateItem(id,branch_id,name);

   return {success:true,data:updated} 
  } catch (error) {
console.error( error);
    return { success: false, message: error.message };    }
};

// Delete Item
async function removeExpItem (id) {
  try {
    const deleted = await repository.deleteItem(id);

   return  { success: true, data: deleted }
  } catch (error) {
console.error( error);
    return { success: false, message: error.message };    }
};

async function updateMenustaus(menu_id, active) {
  try {
    const updatestatus = await repository.updateActive(menu_id, active)
    return { success: true, data: updatestatus }

  } catch (err) {
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
      message: error.message
    };
  }
}

async function deleteExpense(id) {
  try{
     const result = await repository.deleteExpense(id);
 return {
      success: true,
      data: result,
    };

  }catch (error) {
    console.error("Error Deleteing Expense", error);
    return {
      success: false,
      message: error.message
    };
  }
  
}

async function deletePurchase(id) {
  try{
     const result = await repository.deletePurchase(id);
 return {
      success: true,
      data: result,
    };

  }catch (error) {
    console.error("Company Data Getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
  
}

async function getCategoryData(type,branch_id) {
  try {
    const allCategoryData = await repository.get_category_data(type,branch_id);

    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function addCategoryData(zodu_id, branch_id, name, type) {
  try {
    const addedCategory = await repository.createCategory(zodu_id, branch_id, name, type);
    return {
      success: true,
      data: addedCategory,
    };
  } catch (error) {
    console.error("Category Data adding Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function addExpenseCategory(zodu_id, branch_id, name) {
  try {
    const addedCategory = await repository.createExpenseCategory(zodu_id, branch_id, name);
    return {
      success: true,
      data: addedCategory,
    };
  } catch (error) {
    console.error("Category Data adding Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}


async function updateCategoryData(id, name, type, branch_id) {
  try {
    const updatedCategory = await repository.updateCategory(id, name, type, branch_id);
    return {
      success: true,
      data: updatedCategory,
    };
  } catch (error) {
    console.error("Category Data updating Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}
async function deleteCategoryData(id, branch_id) {
  try {
    const deletedCategory = await repository.deleteCategory(id, branch_id);
    return {
      success: true,
      data: deletedCategory.message,
    };
  } catch (error) {
    console.error("Category Data deleting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}


async function updateExpenseCategory(name,id,branch_id) {
  try {
    const updatedCategory = await repository.updateExpenseCategory(name,id,branch_id);
    return {
      success: true,
      data: updatedCategory,
    };
  } catch (error) {
    console.error("Category Data updating Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}
async function deleteExpenseCategory(id) {
  try {
    console.log("fromserv",id)
    const deletedCategory = await repository.deleteExpenseCategory(id);
    return {
      success: true,
      data: deletedCategory,
    };
  } catch (error) {
    console.error("Category Data deleting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function getHoldData(branch_id) {
  try {
    const allCategoryData = await repository.getHold(branch_id);
    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function getExpenseCategoryData(branch_id) {
  try {
    const allCategoryData = await repository.get_expense_category_data(branch_id);
    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}
async function getUnits(branch_id) {
  if (!branch_id) throw new Error("branch_id is required");
  try {
    const units = await repository.getUnits(branch_id);
    return {
      success: true,
      data: units,
    };
  } catch (error) {
    console.error("Units Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
};

async function addUnit(zodu_id, branch_id, name, short_name) {
  try {
    if (!zodu_id || !branch_id || !name || !short_name) {
      throw new Error("zodu_id, branch_id, name and short_name are required");
    }
    const addedunits = await repository.addUnit(zodu_id, branch_id, name, short_name);
    return {
      success: true,
      data: addedunits,
    };
  } catch (error) {
    console.error("Units Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
};

async function updateUnit(id, name, short_name) {
  if (!id) throw new Error("id is required");
  if (!name) throw new Error("name is required");
  if (!short_name) throw new Error("short_name is required");
  return await repository.updateUnit(id, name, short_name);
};

async function deleteUnit(id, branch_id) {
  if (!id) throw new Error("id is required");
  return await repository.deleteUnit(id, branch_id);
};

async function getPurchaseCategoryData(branch_id) {
  try {
    const allCategoryData = await repository.get_purchase_category_data(branch_id);
    return {
      success: true,
      data: allCategoryData,
    };
  } catch (error) {
    console.error("Category Data getting Error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

async function deleteFileFromMinIO(fileName) {
  try {
    if (!fileName) throw new Error("File name required");

    await minioClient.removeObject(bucketName, fileName);

    return { success: true, message: "File deleted successfully" };

  } catch (err) {
    console.error("MinIO Delete Error:", err);
    return { success: false, message: err.message };
  }
};

async function getGST(branch_id) {
  try {
    if (!branch_id) throw new Error("branch_id is required");

    const gstList = await repository.getGST(branch_id);

    return {
      success: true,
      data: gstList,
    };

  } catch (error) {
    console.error("GST Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

// ADD GST
async function addGST(zodu_id, branch_id, gst_rate) {
  try {
    if (!zodu_id || !branch_id || gst_rate === undefined) {
      throw new Error("zodu_id, branch_id, and gst_rate are required");
    }

    const addedGST = await repository.addGST(
      zodu_id,
      branch_id,
      gst_rate
    );

    return {
      success: true,
      data: addedGST,
    };

  } catch (error) {
    console.error("GST Add Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

// UPDATE GST
async function updateGST(id, gst_rate) {
  try {
    if (!id || gst_rate === undefined) {
      throw new Error("id and gst_rate are required");
    }

    const updated = await repository.updateGST(id, gst_rate);

    return {
      success: true,
      data: updated,
    };

  } catch (error) {
    console.error("GST Update Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

// DELETE GST
async function deleteGST(id) {
  try {
    if (!id) throw new Error("id is required");

    const deleted = await repository.deleteGST(id);

    return {
      success: true,
      data: deleted,
    };

  } catch (error) {
    console.error("GST Delete Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}


async function get_Report(data) {
  try {
    const ReportData = await repository.getReport(data)
    return {
      success: true,
      data: ReportData,
    };
  } catch (error) {
    console.error("Report error", error);
    return {
      success: false,
      message: error.message
    };
  }

}

async function get_dashboard(zodu_id, branch_id, options = {}) {
  try {
    const DashboardData = await repository.getDashboard(zodu_id, branch_id, options);
    return {
      success: true,
      data: DashboardData.data || DashboardData,
      pagination: DashboardData.pagination || {}
    };
  } catch (error) {
    console.error("Dashboard error", error);
    return {
      success: false,
      message: error.message
    };
  }
}

// --- Orders Summary ---



// --- Purchase Summary ---
async function getPurchaseSummary(zodu_id, branch_id, filterType, start_date, end_date, page = 1, limit = 5,search) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getPurchaseSummary(zodu_id, branch_id, startDate, endDate,search);

    const data = reportData?.data || {};
    const topItems = Array.isArray(data.top_purchase_items) ? data.top_purchase_items : [];

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const paginatedTopItems = topItems.slice(skip, skip + limitNum);

    return {
      success: true,
      message: reportData?.message || "Purchase summary fetched successfully",
      data: {
        ...data,
        top_purchase_items: paginatedTopItems,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: topItems.length,
        totalPages: Math.ceil(topItems.length / limitNum),
      },
    };
  } catch (error) {
    console.error("Service Error (getPurchaseSummary):", error);
    return { success: false, message: error.message };
  }
}



// --- Expense Summary ---
async function getExpenseSummary(zodu_id, branch_id, filterType, start_date, end_date,search) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getExpenseSummary(zodu_id, branch_id, startDate, endDate,search);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Expense summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getExpenseSummary):", error);
    return { success: false, message: error.message };
  }
}

// --- Inventory Summary ---
async function getInventorySummary(zodu_id, branch_id, filterType, start_date, end_date,search) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getInventorySummary(zodu_id, branch_id, startDate, endDate,search);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Inventory summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getInventorySummary):", error);
    return { success: false, message: error.message };
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

async function getInventoryListData(branch_id, type,category) {
  try {
    const allInventoryData = await repository.get_inventory_list(branch_id, type,category);
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

  try {
 
    const InventoryData = await repository.addin_Inventory(data)
    return {
      success: true,
      data: InventoryData
    }

  } catch (err) {
    console.error("Inventory Update Failed", err);
    return {
      success: false,
      message: err.message
    };
  }
}

async function addHoldMenu(data) {
  try {

    const {
      zodu_id,
      branch_id,
      orderType,
      table_no,
      customerName,
      customerPhone,
      items
    } = data;

    // 1️⃣ Create new hold
    const hold_id = await repository.createHold(
      zodu_id,
      branch_id,
      orderType,
      table_no,
      customerName,
      customerPhone
    );

    // 2️⃣ Insert all hold items
    for (const item of items) {
      await repository.insertHoldItem(hold_id, zodu_id, branch_id, item);
    }


    return {
      success: true,
      message: "Hold saved successfully",
      hold_id,
    };

  } catch (error) {
    console.error("❌ Hold Add Failed:", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

async function getPurchaseSummary(zodu_id, branch_id, filterType, start_date, end_date, page = 1, limit = 5) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getPurchaseSummary(zodu_id, branch_id, startDate, endDate);

    const data = reportData?.data || {};
    const topItems = Array.isArray(data.top_purchase_items) ? data.top_purchase_items : [];

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const paginatedTopItems = topItems.slice(skip, skip + limitNum);

    return {
      success: true,
      message: reportData?.message || "Purchase summary fetched successfully",
      data: {
        ...data,
        top_purchase_items: paginatedTopItems,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: topItems.length,
        totalPages: Math.ceil(topItems.length / limitNum),
      },
    };
  } catch (error) {
    console.error("Service Error (getPurchaseSummary):", error);
    return { success: false, message: error.message };
  }
}



// --- Expense Summary ---
async function getExpenseSummary(zodu_id, branch_id, filterType, start_date, end_date) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getExpenseSummary(zodu_id, branch_id, startDate, endDate);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Expense summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getExpenseSummary):", error);
    return { success: false, message: error.message };
  }
}

// --- Inventory Summary ---
async function getInventorySummary(zodu_id, branch_id, filterType, start_date, end_date) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getInventorySummary(zodu_id, branch_id, startDate, endDate);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Inventory summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getInventorySummary):", error);
    return { success: false, message: error.message };
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

async function update_Inventory(data) {
  try {
    const updatedInventory = await repository.updateInventory(data)
    return { success: true, data: updatedInventory }

  } catch (error) {
    console.error("Menu Item Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}

async function updateMenuItem(menuId, menuData) {

  try {

   //  const CategoryCreate = await repository.createCategory(
    //   menuData.zodu_id,
    //   menuData.branch_id,
    //   menuData.menu_category,
    //   menuData.menu_type
    // );
    // menuData.menu_category_id = CategoryCreate.id;

    const updated = await repository.updateMenuItem(menuId, menuData);
    return { success: true, data: updated };
  } catch (err) {
    console.error("Unable to update menu item: " + err.message);
    return {
      success: false,
      message: err.message,
    };
  }
};

async function replaceUnit(old_unit_id, new_unit_id, branch_id) {
  try {
    const data = await repository.replaceUnit(old_unit_id, new_unit_id, branch_id);

    return { success: true, data: data };
  } catch (err) {
    console.error("Unable to replace unit: " + err.message);
    return {
      success: false,
      message: err.message,
    };
  }
};

async function deleteMenuItem(menuId) {
  try {
    const data = await repository.deleteMenuItem(menuId);

    return { success: true, data: data };
  } catch (err) {
    console.error("Unable to delete menu item: " + err.message);
    return {
      success: false,
      message: err.message,
    };
  }
};

async function get_menuItem_data(branch_id, page, limit, search) {
  try {
    const allMenuItemData = await repository.get_menuItem_data(
      branch_id,
      page,
      limit,
      search
    );

    // Extract pagination info from repository response
    const {
      total_count,
      total_pages,
      current_page,
      limit: pageLimit,
      rows,
    } = allMenuItemData;

    // ---- Process categories + item variants ----
    const categories = (rows || []).map((category) => {
      const items = (category.items || []).map((item) => {
        let variants = item.variants;

        try {
          if (typeof variants === "string") {
            variants = JSON.parse(variants);
          }
        } catch (err) {
          variants = [];
        }

        return { ...item, variants };
      });

      return { ...category, items };
    });

    // ---- Return pagination + data ----
    return {
      success: true,
      pagination: {
        total_count,
        total_pages,
        current_page,
        limit: pageLimit,
      },
      data: categories,
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}


async function get_pos_data(data) {
  try {
    const posData = await repository.get_pos_data(data);
    return {
      success: true,
      data: posData.rows,
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

    // if (menuData.menu_image) {
    //   const imgResult = await uploadImg(menuData.menu_image);
    //   if (!imgResult.success) {
    //     throw new Error(imgResult.message || "Image upload failed");
    //   }
    //   menuData.menu_image = imgResult.fileUrl;
    // }

    // const CategoryCreate = await repository.createCategory(
    //   menuData.zodu_id,
    //   menuData.branch_id,
    //   menuData.menu_category,
    //   menuData.menu_type
    // );
    // menuData.menu_category_id = CategoryCreate.id;

    // Generate safe sequential menu_id (no extra table needed)
    const nextNumber = await repository.getNextMenuId(
      menuData.zodu_id,
      menuData.branch_id
    );
    menuData.menu_id = `${menuData.zodu_id}-${menuData.branch_id}-${nextNumber}`;
    menuData.menu_code = menuData.item_code
    menuData.favorites = false

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

async function editMenuItem(menuId, menuData) {
  try {
    // 1. Fetch existing menu item
    const existingMenu = await repository.getMenuById(menuId);
    if (!existingMenu) {
      return { success: false, message: "Menu item not found" };
    }

    // 2. Handle QR code: only if item_code changed
    if (menuData.item_code && menuData.item_code !== existingMenu.menu_code) {
      const qrResult = await repository.createQRCode(menuData.item_code);
      menuData.qr_code_id = qrResult.id;
    } else {
      menuData.qr_code_id = existingMenu.qr_code_id;
    }

    
    // 5. Prepare updated fields: keep old values if not provided
    const updatedMenu = {
      ...existingMenu,
      ...menuData, // overwrite only fields provided
      menu_id: existingMenu.menu_id, // menu_id never changes
      menu_code: menuData.item_code || existingMenu.menu_code
    };

    // 6. Update menu in DB
    const result = await repository.updateMenuItem(menuId, updatedMenu);

    return {
      success: true,
      message: "Menu item updated successfully",
      data: result
    };

  } catch (err) {
    console.error("Error updating menu item:", err);
    return {
      success: false,
      message: err.message
    };
  }
}


async function createOrder(orderData) {

  try {
    const newOrder = await repository.createOrder(orderData);
    const neworderItem = await repository.createOrderedItems(orderData);
    let newKot = null;
    if (orderData.order_type === "Dine-In") {
      newKot = await repository.createKOT(orderData);
    }
    return {
      success: true,
      message: "Order created successfully",
      data: { newOrder, neworderItem, newKot },
    };
  } catch (err) {
    console.error("Error inserting Order:", err);
    return {
      success: false,
      message: err.message,
    };
  }
}

async function getPurchaseListData(
  branch_id,
  page,
  limit,
  search,
  status,
  start_date,
  end_date,
  category_id
) {
  try {
    const allPurchaseData = await repository.get_purchase(
      branch_id,
      page,
      limit,
      search,
      status,
      start_date,
      end_date,
      category_id
    );

    return {
      success: true,
      data: allPurchaseData,
    };

  } catch (error) {
    console.error("Purchase Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}




async function getExpenseListData(params) {
  try {
    const data = await repository.get_Expense(params);
    return { success: true, data };
  } catch (error) {
    return { success: false, message: error.message };
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

async function editVendor(vendorData) {
  try {

    const newVendor = await repository.editVendor(vendorData);
    return {
      success: true,
      message: "Vendor update successfully",
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

async function deleteVendor(id) {
  try{
     const result = await repository.deleteVendor(id);
 return {
      success: true,
      data: result.deleted,
    };

  }catch (error) {
    console.error("Error Deleteing Vendor", error);
    return {
      success: false,
      message: error.message
    };
  }
  
}

async function createPurchaseOrder(purchaseOrderData) {
  try {

    const nextPurchaseId = await repository.getNextPurchaseId(
      purchaseOrderData.branch_id
    );

    purchaseOrderData.purchase_id = `${purchaseOrderData.branch_id}-PO${nextPurchaseId}`;

 
    await repository.createPurchaseOrder(purchaseOrderData);

    await repository.insertPurchaseItems(
      purchaseOrderData.purchase_id,
      purchaseOrderData.items
    );

    await repository.addInventory(
      purchaseOrderData.items,
      purchaseOrderData.branch_id,
      purchaseOrderData.zodu_id,
      purchaseOrderData.purchase_date,
      purchaseOrderData.category,
      purchaseOrderData.purchase_type
    );

    // purchaseOrderData.expense_date = purchaseOrderData.purchase_date;

    // await repository.addExpense(purchaseOrderData);

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
 

    await repository.addExpense(expenseData);

    return {
      success: true,
      message: "Expense order created successfully",
    };
  } catch (err) {
    console.error("Error inserting Expense", err);
    return {
      success: false,
      message: err.message,
    };
  };

}


async function editExpense(expenseData) {
  try {
    // 1. Fetch existing expense
    const existingExpense = await repository.getExpenseById(expenseData.expense_id);
    // console.log(existingExpense);
    if (!existingExpense) {
      return { success: false, message: "Expense not found" };
    }
    // 5. Update expense in DB
    const result = await repository.edit_expense(expenseData );


    return {
      success: true,
      message: "Expense updated successfully",
      data: result
    };

  } catch (err) {
    console.error("Error updating expense:", err);
    return {
      success: false,
      message: err.message
    };
  }
}

async function editPurchase(purchaseData) {
  try {
    // 1. Fetch existing purchase
    const existingPurchase = await repository.getPurchaseById(purchaseData.purchaseId);

    if (!existingPurchase) {
      return { success: false, message: "Purchase not found" };
    }



    const updatedPurchase = {
      ...existingPurchase,
      ...purchaseData, // overwrite only fields provided
      purchase_id: existingPurchase.purchase_id, // purchase_id never changes
    };

    // 6. Update purchase in DB
    const result = await repository.updatePurchase(updatedPurchase);

    return {
      success: true,
      message: "Purchase updated successfully",
      data: result
    };

  } catch (err) {
    console.error("Error updating purchase:", err);
    return {
      success: false,
      message: err.message
    };
  }
}

async function getPurchaseSummary(zodu_id, branch_id, filterType, start_date, end_date, page = 1, limit = 5) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getPurchaseSummary(zodu_id, branch_id, startDate, endDate);

    const data = reportData?.data || {};
    const topItems = Array.isArray(data.top_purchase_items) ? data.top_purchase_items : [];

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const paginatedTopItems = topItems.slice(skip, skip + limitNum);

    return {
      success: true,
      message: reportData?.message || "Purchase summary fetched successfully",
      data: {
        ...data,
        top_purchase_items: paginatedTopItems,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: topItems.length,
        totalPages: Math.ceil(topItems.length / limitNum),
      },
    };
  } catch (error) {
    console.error("Service Error (getPurchaseSummary):", error);
    return { success: false, message: error.message };
  }
}



// --- Expense Summary ---
async function getExpenseSummary(zodu_id, branch_id, filterType, start_date, end_date) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getExpenseSummary(zodu_id, branch_id, startDate, endDate);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Expense summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getExpenseSummary):", error);
    return { success: false, message: error.message };
  }
}

// --- Inventory Summary ---
async function getInventorySummary(zodu_id, branch_id, filterType, start_date, end_date) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getInventorySummary(zodu_id, branch_id, startDate, endDate);

    return {
      success: reportData?.success ?? true,
      message: reportData?.message || "Inventory summary fetched successfully",
      data: reportData?.data || {},
    };
  } catch (error) {
    console.error("Service Error (getInventorySummary):", error);
    return { success: false, message: error.message };
  }
}


// async function getOrdersSummary(zodu_id, branch_id, filterType, start_date, end_date, options = {}) {
//   try {
//     // --- Calculate proper date range ---
//     const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);

//     const {
//       page = 1,
//       limit = 10,
//       sortBy = "order_date",
//       sortOrder = "desc",
//       top = 5,
//       summaryType = "all"   // all | item | category
//     } = options;

//     // --- Fetch from repository ---
//     const reportData = await repository.getOrdersSummary(
//       zodu_id,
//       branch_id,
//       startDate,
//       endDate,
//       { page, limit, sortBy, sortOrder, top, summaryType }
//     );

//     if (!reportData?.success) {
//       return { success: false, message: reportData?.message || "No data found" };
//     }

//     // --- Build response based on summaryType ---
//     let responseData = {};

//     switch(summaryType) {
//       case "item":
//         responseData = {
//           item_wise_summary: reportData.data.item_wise_summary || [],
//           top_orders: reportData.data.top_orders || []
//         };
//         break;

//       case "category":
//         responseData = {
//           category_wise_summary: reportData.data.category_wise_summary || []
//         };
//         break;

//       case "all":
//       default:
//         responseData = {
//           total_orders: reportData.data.total_orders || 0,
//           total_amount: reportData.data.total_amount || 0,
//           total_quantity: reportData.data.total_quantity || 0,
//           orders: reportData.data.orders || [],
//           top_orders: reportData.data.top_orders || [],
//           item_wise_summary: reportData.data.item_wise_summary || [],
//           category_wise_summary: reportData.data.category_wise_summary || []
//         };
//         break;
//     }

//     return {
//       success: true,
//       message: "Orders summary fetched successfully",
//       data: responseData,
//       pagination: reportData.pagination || {}
//     };

//   } catch (error) {
//     console.error("Service Error (getOrdersSummary):", error);
//     return { success: false, message: error.message };
//   }
// }

// // ============================
// // PURCHASE SUMMARY SERVICE
// // ============================
// async function getPurchaseSummary(
//   zodu_id,
//   branch_id,
//   filterType,
//   start_date,
//   end_date,
//   options = {}
// ) {
//   try {
//     const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);

//     const {
//       page = 1,
//       limit = 10,
//       sortBy = "purchase_date",
//       sortOrder = "desc",
//       top = 5,
//       summaryType = "all"   // <-- add this
//     } = options;

//     const reportData = await repository.getPurchaseSummary(
//       zodu_id,
//       branch_id,
//       startDate,
//       endDate,
//       { page, limit, sortBy, sortOrder, top, summaryType }
//     );

//     if (!reportData?.success) {
//       return { success: false, message: reportData?.message || "No data found" };
//     }

//     // --- return based on mode ---
//     let responseData = {};

//     if (summaryType === "all") {
//       responseData = {
//         total_purchase_count: reportData.data.total_purchase_count || 0,
//         total_amount: reportData.data.total_amount || 0,
//         total_paid: reportData.data.total_paid || 0,
//         total_balance: reportData.data.total_balance || 0,
//         top_items: reportData.data.top_items || [],
//         top_vendors: reportData.data.top_vendors || [],
//         purchases: reportData.data.purchases || []
//       };
//     }

//     if (summaryType === "items") {
//       responseData = {
//         item_wise_summary: reportData.data.item_wise_summary || [],
//         top_items: reportData.data.top_items || []
//       };
//     }

//     if (summaryType === "category") {
//       responseData = {
//         category_wise_summary: reportData.data.category_wise_summary || []
//       };
//     }

//     return {
//       success: true,
//       message: "Purchase summary fetched successfully",
//       data: responseData,
//       pagination: reportData.pagination || {}
//     };

//   } catch (error) {
//     console.error("Service Error (getPurchaseSummary):", error);
//     return { success: false, message: error.message };
//   }
// }

// services/restaurant-service.js (or similar)

async function getOrdersSummary(
  zodu_id,
  branch_id,
  filterType,
  start_date,
  end_date,
  options = {}
) {
  try {
    const { startDate, endDate } = await getDateRange(
      filterType,
      start_date,
      end_date
    );

    const {
      page = 1,
      limit = 10,
      sortBy = "order_date",
      sortOrder = "desc",
      top = 5,
      summaryType = "all", // all | category
      search=""
    } = options;

    const reportData = await repository.getOrdersSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      { page, limit, sortBy, sortOrder, top, summaryType,search }
    );

    if (!reportData?.success) {
      return {
        success: false,
        message: reportData?.message || "No data found",
      };
    }

    const raw = reportData.data;
    let responseData = {};

    if (summaryType === "category") {
      // ✅ only category-wise summary
      responseData = {
        total_orders: raw.total_orders || 0,
        total_amount: raw.total_amount || 0,
        total_quantity: raw.total_quantity || 0,
        category_wise_summary: raw.category_wise_summary || [],
      };
    } else {
      // ✅ overall + orders list (+ category summary if you want)
      responseData = {
        total_orders: raw.total_orders || 0,
        total_amount: raw.total_amount || 0,
        total_quantity: raw.total_quantity || 0,
        orders: raw.orders || [],
        category_wise_summary: raw.category_wise_summary || [],
        // ❌ no item_wise_summary, no top_orders in response
      };
    }

    return {
      success: true,
      message: "Orders summary fetched successfully",
      data: responseData,
      pagination: reportData.pagination || {},
    };
  } catch (error) {
    console.error("Service Error (getOrdersSummary):", error);
    return { success: false, message: error.message };
  }
}

async function getPurchaseSummary(
  zodu_id,
  branch_id,
  filterType,
  start_date,
  end_date,
  options = {}
) {
  try {
    const { startDate, endDate } = await getDateRange(
      filterType,
      start_date,
      end_date
    );

    const {
      page = 1,
      limit = 10,
      sortBy = "purchase_date",
      sortOrder = "desc",
      top = 5,
      summaryType = "all", // all | category
      search=""
    } = options;

    const reportData = await repository.getPurchaseSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      { page, limit, sortBy, sortOrder, top, summaryType,search }
    );

    if (!reportData?.success) {
      return {
        success: false,
        message: reportData?.message || "No data found",
      };
    }

    const raw = reportData.data;
    let responseData = {};

    if (summaryType === "category") {
      responseData = {
        total_purchase_count: parseInt(raw.total_purchase_count || 0),
        total_amount: raw.total_amount || 0,
        total_paid: raw.total_paid || 0,
        total_balance: raw.total_balance || 0,
        category_wise_summary: raw.category_wise_summary || [],
      };
    } else {
      responseData = {
        total_purchase_count: parseInt(raw.total_purchase_count || 0),
        total_amount: raw.total_amount || 0,
        total_paid: raw.total_paid || 0,
        total_balance: raw.total_balance || 0,
        purchases: raw.purchases || [],
        category_wise_summary: raw.category_wise_summary || [],
        // ❌ top_items, top_vendors, item_wise_summary removed
      };
    }

    return {
      success: true,
      message: "Purchase summary fetched successfully",
      data: responseData,
      pagination: reportData.pagination || {},
    };
  } catch (error) {
    console.error("Service Error (getPurchaseSummary):", error);
    return { success: false, message: error.message };
  }
}

async function getExpenseSummary(
  zodu_id,
  branch_id,
  filterType,
  start_date,
  end_date,
  options = {}
) {
  try {
    const { startDate, endDate } = await getDateRange(
      filterType,
      start_date,
      end_date
    );

    const {
      page = 1,
      limit = 10,
      sortBy = "expense_date",
      sortOrder = "desc",
      top = 5,
      summaryType = "all", // all | category
      search =""
    } = options;

    console.log("myseatcj",search )

    const reportData = await repository.getExpenseSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      { page, limit, sortBy, sortOrder, top, summaryType,search  }
    );

    if (!reportData?.success) {
      return {
        success: false,
        message: reportData?.message || "No data found",
      };
    }

    const raw = reportData.data;
    let responseData = {};

    if (summaryType === "category") {
      responseData = {
        total_expense_count: parseInt(raw.total_expense_count || 0),
        total_amount: raw.total_amount || 0,
        total_paid: raw.total_paid || 0,
        total_balance: raw.total_balance || 0,
        category_wise_summary: raw.category_wise_summary || [],
      };
    } else {
      responseData = {
        total_expense_count: parseInt(raw.total_expense_count || 0),
        total_amount: raw.total_amount || 0,
        total_paid: raw.total_paid || 0,
        total_balance: raw.total_balance || 0,
        expenses: raw.expenses || [],
        category_wise_summary: raw.category_wise_summary || [],
        // ❌ item_wise_summary, top_expenses removed
      };
    }

    return {
      success: true,
      message: "Expense summary fetched successfully",
      data: responseData,
      pagination: reportData.pagination || {},
    };
  } catch (error) {
    console.error("Service Error (getExpenseSummary):", error);
    return { success: false, message: error.message };
  }
}

async function getInventorySummary(
  zodu_id,
  branch_id,
  filterType,
  start_date,
  end_date,
  options = {}
) {
  try {
    const { startDate, endDate } = await getDateRange(
      filterType,
      start_date,
      end_date
    );

    const {
      page = 1,
      limit = 10,
      sortBy = "updated_at",
      sortOrder = "desc",
      top = 5,
      summaryType = "all", // all | category
      search=""
    } = options;

    const reportData = await repository.getInventorySummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      { page, limit, sortBy, sortOrder, top, summaryType,search }
    );

    if (!reportData?.success) {
      return {
        success: false,
        message: reportData?.message || "No inventory data found",
      };
    }

    const raw = reportData.data;
    let responseData = {};

    if (summaryType === "category") {
      responseData = {
        total_items: parseInt(raw.total_items || 0),
        total_stock_qty: parseFloat(raw.total_stock_qty || 0),
        total_stock_value: parseFloat(raw.total_stock_value || 0),
        category_wise_summary: raw.category_wise_summary || [],
      };
    } else {
      responseData = {
        total_items: parseInt(raw.total_items || 0),
        total_stock_qty: parseFloat(raw.total_stock_qty || 0),
        total_stock_value: parseFloat(raw.total_stock_value || 0),
        inventory_list: raw.inventory_list || [],
        category_wise_summary: raw.category_wise_summary || [],
        // ❌ low_stock_items, recently_updated_items removed
      };
    }

    return {
      success: true,
      message: "Inventory summary fetched successfully",
      data: responseData,
      pagination: reportData.pagination || {},
    };
  } catch (error) {
    console.error("Service Error (getInventorySummary):", error);
    return { success: false, message: error.message };
  }
}




 async function makePayment (data)  {
  const {
    zodu_id,
    branch_id,
    source_type, // purchase or expense
    source_id,
    paid_amount,
    payment_type,
   
  } = data;

  // ensure main payment record
  const paymentRow = await repository.ensurePaymentForSource({
    zodu_id,
    branch_id,
    source_type,
    source_id,
    total_amount: data.total_amount,
  });

  // create payment record (always append)
  const history = await repository.insertPaymentHistory({
    payment_id: paymentRow.payment_id,
    zodu_id,
    branch_id,
    paid_amount,
    payment_type,
 
  });

  return {
    success: true,
    message: "Payment applied",
    data: { paymentRow, history },
  };
};










// Export all functions
module.exports = {
  createCompanyService,
  getData,
  createBranch,
  createMenuItem,
  editMenuItem,
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
  editExpense,
  editPurchase,
  update_Inventory,
  get_Report,
  addin_Inventory,
  update_Final_payment,
  get_dashboard,
  getInventorySummary,
  getPurchaseSummary,
  getExpenseCategoryData,
  addHoldMenu,
  getHoldData,
  uploadMultiple,
  deleteFileFromMinIO,
  getOrdersSummary,
  getExpenseSummary,
  get_pos_data,
  getPurchaseCategoryData,
  addUnit,
  getUnits,
  updateUnit,
  deleteUnit,
  getGST,
  addGST,
  updateGST,
  deleteGST,
  updateMenuItem,
  deleteMenuItem,
  replaceUnit,
  addCategoryData,
  updateCategoryData,
  deleteCategoryData,
  createExpenseItem,
  getExpAllItems,
  removeExpItem,
  editExpItem,
  deleteExpense,
  updateExpenseCategory,
  deleteExpenseCategory,
  addExpenseCategory,
  deletePurchase,
  editVendor,
  deleteVendor,
  makePayment
};
