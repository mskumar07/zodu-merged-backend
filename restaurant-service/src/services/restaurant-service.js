const multer = require('multer');
const { consumeEvents } = require('../consumer/consumer');
const Minio = require("minio");
const sharp = require("sharp");
const conn = require('../database/connection.js');
const repository = require('../repository/restaurant-repo.js');
const { PDFDocument } = require('pdf-lib');
const moment = require('moment/moment');
const { DB_HOSTNAME, MINIO_PORT, MINIO_ACCESSKEY, MINIO_SECRETKEY, BUCKET_NAME } = require('../config/index.js');
const { getDateRange } = require("../utils/Date_Folder/getDate.js");
const { get } = require('../api/restaurant-controller.js');
const { getPagination, getMeta } = require('../utils/pagination.js');
const stockRepository = require('../repository/menu-repo');




const minioClient = new Minio.Client({
  endPoint: DB_HOSTNAME, // e.g. 123.45.67.89
  port: MINIO_PORT,
  useSSL: false,
  accessKey: MINIO_ACCESSKEY,
  secretKey: MINIO_SECRETKEY
});

const bucketName = BUCKET_NAME;

const normalizeBranchIds = (branchIds) => {
  const normalized = Array.isArray(branchIds)
    ? branchIds
        .flatMap((value) => String(value).split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    : String(branchIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  if (normalized.some((value) => value.toLowerCase() === "all")) {
    return [];
  }

  return normalized;
};

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

async function getReportServices(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year,search) {
  try {
    const ReportData = await repository.get_all_report_data(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year,search);
    if (!ReportData) return { success: false, message: "Report Data Not Found" };

    const totalCount = Number(ReportData.totals?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    return {
      success: true,
      data: ReportData.rows,
      datewise_summary: ReportData.datewise_summary || [],
      monthly_summary: ReportData.monthly_summary || [],
      totalAmount: Number(ReportData.totals?.all_total_amount || 0),
      totalItems: Number(ReportData.totals?.all_items_total || 0),
      pagination: {
        page,
        limit,
        totalRecords: totalCount,
        totalPages,
      },
    };
  } catch (err) {
    console.error("Error getting report data:", err);
    return { success: false, message: err.message };
  }
}

async function getPurchaseReportServices(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year) {
  try {
    const PurchaseReportData = await repository.get_purchase_report_data(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year);
    if (!PurchaseReportData) return { success: false, message: "Purchase Report Data Not Found" };

    const totalCount = Number(PurchaseReportData.totals?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    return {
      success: true,
      data: PurchaseReportData.rows,
      datewise_summary: PurchaseReportData.datewise_summary || [],
      monthly_summary: PurchaseReportData.monthly_summary || [],
      over_all_purchase: totalCount,
      totalAmount: Number(PurchaseReportData.totals?.all_total_amount || 0),
      totalPaid: Number(PurchaseReportData.totals?.all_total_paid || 0),
      totalDue: Number(PurchaseReportData.totals?.all_total_due || 0),
      pagination: {
        page,
        limit,
        totalRecords: totalCount,
        totalPages,
      },
    };
  } catch (err) {
    console.error("Error getting purchase report data:", err);
    return { success: false, message: err.message };
  }
}

async function getReportCategory(
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  search = ""
) {
  try {
    const reportData =
      await repository.get_category_item_wise_report(
        zodu_id,
        branch_id,
        page,
        limit,
        search
      );

    if (!reportData) {
      return {
        success: false,
        message: "Category Report Data Not Found"
      };
    }

    return {
      success: true,
      summary: {
        totalOrders: Number(reportData.overall_summary?.total_orders || 0),
        totalQty: Number(reportData.overall_summary?.total_qty || 0),
        totalAmount: Number(reportData.overall_summary?.total_amount || 0)
      },
      data: reportData.rows || [],
      pagination: reportData.pagination
    };
  } catch (err) {
    console.error("Error getting category report:", err);
    return {
      success: false,
      message: err.message
    };
  }
}



async function getExpenseReportServices(
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  filtered_type,
  start_date,
  end_date,
  year
) {
  try {
    const ReportData = await repository.get_expense_report(
      zodu_id,
      branch_id,
      page,
      limit,
      filtered_type,
      start_date,
      end_date,
      year
    );

    if (!ReportData) {
      return {
        success: false,
        message: "Report Data Not Found"
      };
    }

    const overall = ReportData.overall_summary || {};

    return {
      success: true,

      data: ReportData.rows || [],
      datewise_summary: ReportData.datewise_summary || [],
      monthly_summary: ReportData.monthly_summary || [],

      totalBills: Number(overall.totalBills || 0),
      totalAmount: Number(overall.totalAmount || 0),
      totalPaid: Number(overall.totalPaid || 0),
      totalUnpaid: Number(overall.totalUnpaid || 0),
      totalItems: Number(overall.totalItems || 0),

      pagination: ReportData.pagination || {
        page,
        limit,
        totalRecords: 0,
        totalPages: 0
      }
    };

  } catch (err) {
    console.error("Error getting report data:", err);
    return {
      success: false,
      message: err.message
    };
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

// async function get_dashboard(zodu_id, branch_id, options) {
//   try {
//     const {
//       ordersPage = 1,
//       ordersLimit = 10,
//       expensesPage = 1,
//       expensesLimit = 10,
//       topItemsPage = 1,
//       topItemsLimit = 5,
//       datePage = 1,
//       dateLimit = 7,
//       sortOrder = "desc",

//       // 👇 NEW
//       dateType = "today",
//       fromDate,
//       toDate
//     } = options;

//     const pagination = {
//       orders: getPagination({ page: ordersPage, limit: ordersLimit }),
//       expenses: getPagination({ page: expensesPage, limit: expensesLimit }),
//       topItems: getPagination({ page: topItemsPage, limit: topItemsLimit }),
//       datewise: getPagination({ page: datePage, limit: dateLimit }),
//     };

//     const result = await repository.getDashboard(
//       zodu_id,
//       branch_id,
//       pagination,
//       sortOrder,
//       { dateType, fromDate, toDate } // 👈 pass filter
//     );

//     return {
//       success: true,
//       data: result.data,
//       pagination: {
//         orders: getMeta({ ...pagination.orders, total: result.counts.orders }),
//         expenses: getMeta({ ...pagination.expenses, total: result.counts.expenses }),
//         topItems: getMeta({ ...pagination.topItems, total: result.counts.topItems }),
//         datewise: getMeta({ ...pagination.datewise, total: result.counts.datewise })
//       }
//     };
//   } catch (err) {
//     console.error("Dashboard Service Error:", err);
//     return { success: false, message: err.message };
//   }
// }


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
async function getExpenseSummary(zodu_id, branch_id, filterType, start_date, end_date,search,reportView) {
  try {
    const { startDate, endDate } = await getDateRange(filterType, start_date, end_date);
    const reportData = await repository.getExpenseSummary(zodu_id, branch_id, startDate, endDate,search,reportView);

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

async function deleteHoldMenu(hold_id) {

  try {
    await repository.deleteHold(hold_id);

    return {
      success: true,
      message: "Hold deleted successfully",
    };
  } catch (error) {
    console.error("❌ Hold Delete Failed:", error);
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

async function getSingleOrder (zodu_id, branch_id, api_order_id) {
  try {
    const order = await repository.getSingleOrder(
      zodu_id,
      branch_id,
      api_order_id
    );

    return order;
  } catch (error) {
    console.error("getSingleOrder error:", error);
    throw new Error(error.message);
  }
};


async function update_Final_payment(data) {
  try {
    const result = await repository.updateFinalPayment(data);

    return {
      success: true,
    
        order: result.order,
        public_order_no: result.public_order_no // ✅ PRINT THIS
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

    const createQr = await repository.createQRCode(branchData.branch_id);
    branchData.qr_code_id = createQr.id;

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

async function createProduct(productData) {
  try {

    const product = await repository.createProduct(productData);

    return {
      success: true,
      message: "Product created successfully",
      data: product
    };

  } catch (err) {
    return {
      success: false,
      message: err.message
    };
  }
}


async function createOrder(orderData) {
  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    // ✅ 1. CREATE SALE
    const sale = await repository.createOrder(orderData, client);

    // ✅ 2. CREATE ITEMS
    const items = await repository.createSaleItems(orderData, sale, client);

    // ✅ 3. STOCK DEDUCTION + LEDGER
    for (const item of orderData.items) {
      const qty = Number(item.quantity || 0);

      if (!qty || qty <= 0) {
        throw new Error(`Invalid quantity for item ${item.item_id}`);
      }


      

      // ✅ FIX: use correct repo method
      const inventory = await stockRepository.getInventoryByItemUuid(
        client,
        item.item_uuid
      );

      if (!inventory) {
        throw new Error(`Inventory not found for item ${item.item_id}`);
      }

      // 🔒 LOCK ROW (IMPORTANT)
      const locked = await client.query(
        `SELECT available_qty
         FROM tbl_inventory
         WHERE item_uuid = $1
         FOR UPDATE`,
        [item.item_uuid]
      );

      const stock_before = Number(locked.rows[0].available_qty);

      if (qty > stock_before) {
        throw new Error(`Insufficient stock for ${inventory.item_name}`);
      }

      const stock_after = stock_before - qty;

      // ✅ UPDATE INVENTORY
      await client.query(
        `UPDATE tbl_inventory
         SET available_qty = $1,
             last_stock_update = NOW()
         WHERE item_uuid = $2`,
        [stock_after, item.item_uuid]
      );

      // ✅ STOCK LEDGER
      await stockRepository.createStockLedger(client, {
        item_uuid: inventory.item_uuid,
        item_id: inventory.item_id,
        zodu_id: inventory.zodu_id,
        branch_id: inventory.branch_id,
        item_name: inventory.item_name,
        transaction_type: "sale",
        reference_id: sale.sale_uuid,
        qty_change: -qty,
        stock_before,
        stock_after,
        notes: "Sale Order",
      });
    }

    // ✅ 4. PAYMENT HANDLING
    let payment = null;
    const paidAmount = Number(orderData.paid_amount || 0);

    if (paidAmount > 0) {
      payment = await repository.createSalesPayment(orderData, sale, client);

    }

    await client.query("COMMIT");

    return {
      success: true,
      message: "Order created successfully",
      order: sale,
      items,
      payment,
    };

  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Order Error:", err);

    return {
      success: false,
      message: err.message,
    };
  } finally {
    client.release();
  }
}

async function updateOrder(orderData) {
  const client = await conn.connect();

  try {
    await client.query("BEGIN");

    const saleId = orderData.sale_uuid;

    // ✅ SAFE CUSTOMER
    const customerId =
      orderData.customer_id !== undefined &&
      orderData.customer_id !== null &&
      orderData.customer_id !== ""
        ? orderData.customer_id
        : null;

    // =========================================================
    // 1️⃣ GET OLD ITEMS
    // =========================================================
    const oldItemsRes = await client.query(
      `SELECT si.*, m.item_uuid
       FROM tbl_sale_items si
       LEFT JOIN tbl_menu_items m
         ON m.item_id::text = si.item_id
       WHERE si.sale_uuid = $1`,
      [saleId]
    );

    const oldItems = oldItemsRes.rows;

    // =========================================================
    // 2️⃣ RESTORE OLD STOCK
    // =========================================================
    for (const item of oldItems) {
      const qty = Number(item.quantity);

      if (!item.item_uuid) continue;

      const inv = await client.query(
        `SELECT available_qty FROM tbl_inventory 
         WHERE item_uuid = $1 FOR UPDATE`,
        [item.item_uuid]
      );

      if (!inv.rows.length) continue;

      const stock_before = Number(inv.rows[0].available_qty);
      const stock_after = stock_before + qty;

      await client.query(
        `UPDATE tbl_inventory 
         SET available_qty = $1 
         WHERE item_uuid = $2`,
        [stock_after, item.item_uuid]
      );

      await stockRepository.createStockLedger(client, {
        item_uuid: item.item_uuid,
        item_id: item.item_id,
        zodu_id: orderData.zodu_id,
        branch_id: orderData.branch_id,
        item_name: item.item_name,
        transaction_type: "sale_update_reverse",
        reference_id: saleId,
        qty_change: qty,
        stock_before,
        stock_after,
        notes: "Sale Update Reverse",
      });
    }

    // =========================================================
    // 3️⃣ DELETE OLD ITEMS
    // =========================================================
    await client.query(
      `DELETE FROM tbl_sale_items WHERE sale_uuid = $1`,
      [saleId]
    );

    // =========================================================
    // 4️⃣ CALCULATE TOTALS (🔥 IMPORTANT FIX)
    // =========================================================
    let subtotal = 0;
    let totalTax = 0;

    for (const item of orderData.items) {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const gst = Number(item.gst_percentage || 0);

      if (qty <= 0) throw new Error(`Invalid qty for ${item.item_name}`);
      if (price <= 0) throw new Error(`Invalid price for ${item.item_name}`);

      const base = qty * price;

      let tax = 0;

      if (item.tax_inclusive) {
        tax = base - base / (1 + gst / 100);
      } else {
        tax = base * (gst / 100);
      }

      subtotal += base;
      totalTax += tax;
    }

    const totalAmount = subtotal;
    const paidAmount = Number(orderData.paid_amount || 0);
    const discountAmount = Number(orderData.discount_value || 0);
    const balanceAmount = totalAmount - paidAmount;

    let paymentStatus = "pending";

    if (paidAmount >= totalAmount) {
      paymentStatus = "paid";
    } else if (paidAmount > 0) {
      paymentStatus = "partial";
    }

    // =========================================================
    // 5️⃣ UPDATE SALE HEADER
    // =========================================================
    await client.query(
      `UPDATE tbl_sales
       SET subtotal = $1,
           total_tax = $2,
           total_amount = $3,
           paid_amount = $4,
           discount_amount = $5,
           balance_amount = $6,
           payment_status = $7,
           customer_id = $8,
           updated_at = NOW()
       WHERE sale_uuid = $9`,
      [
        subtotal,
        totalTax,
        totalAmount,
        paidAmount,
        discountAmount,
        balanceAmount,
        paymentStatus,
        customerId,
        saleId,
      ]
    );

    // =========================================================
    // 6️⃣ INSERT NEW ITEMS + STOCK DEDUCT
    // =========================================================
    for (const item of orderData.items) {
      await client.query(
        `INSERT INTO tbl_sale_items (
          sale_uuid,
          item_id,
          item_name,
          unit,
          quantity,
          price,
          gst_percentage,
          discount,
          hsn_code,
          mrp,
          tax_inclusive
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          saleId,
          item.item_id,
          item.item_name,
          item.unit,
          item.quantity,
          item.price,
          item.gst_percentage,
          item.discount || 0,
          item.hsn_code || null,
          item.mrp || 0,
          item.tax_inclusive || false,
        ]
      );

      // 🔒 LOCK STOCK
      const inv = await client.query(
        `SELECT available_qty FROM tbl_inventory 
         WHERE item_uuid = $1 FOR UPDATE`,
        [item.item_uuid]
      );

      if (!inv.rows.length) {
        throw new Error(`Inventory not found for ${item.item_name}`);
      }

      const stock_before = Number(inv.rows[0].available_qty);

      if (item.quantity > stock_before) {
        throw new Error(`Insufficient stock for ${item.item_name}`);
      }

      const stock_after = stock_before - item.quantity;

      await client.query(
        `UPDATE tbl_inventory 
         SET available_qty = $1 
         WHERE item_uuid = $2`,
        [stock_after, item.item_uuid]
      );

      await stockRepository.createStockLedger(client, {
        item_uuid: item.item_uuid,
        item_id: item.item_id,
        zodu_id: orderData.zodu_id,
        branch_id: orderData.branch_id,
        item_name: item.item_name,
        transaction_type: "sale_update",
        reference_id: saleId,
        qty_change: -item.quantity,
        stock_before,
        stock_after,
        notes: "Sale Update",
      });
    }

    await client.query("COMMIT");

    return {
      success: true,
      message: "Order updated successfully",
    };

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    return { success: false, message: err.message };
  } finally {
    client.release();
  }
}
 
const round = (n) => Math.round(n * 100) / 100;

async function getSalesHistory(filters) {
  try {
    const data = await repository.getSalesHistory(filters);
    return { success: true, ...data };
  } catch (err) {
    console.error("getSalesHistory Error:", err);
    return { success: false, message: err.message };
  }
}
 
async function getSaleById(sale_id, zodu_id, branch_id) {
  try {
    const data = await repository.getSaleById(sale_id, zodu_id, branch_id);
    if (!data) return { success: false, message: "Sale not found" };
    return { success: true, data };
  } catch (err) {
    console.error("getSaleById Error:", err);
    return { success: false, message: err.message };
  }
}


async function getCustomers(filters) {
  try {
    const data = await repository.getCustomers(filters);
    return { success: true, ...data };
  } catch (err) {
    console.error("getCustomers Error:", err);
    return { success: false, message: err.message };
  }
}
 
async function getCustomerById(cust_uuid) {
  try {
    const customer = await repository.getCustomerById(cust_uuid);
 
    if (!customer) {
      return { success: false, message: "Customer not found" };
    }
 
    return { success: true, customer };
  } catch (err) {
    console.error("getCustomerById Error:", err);
    return { success: false, message: err.message };
  }
}


async function createCustomer(data) {
  try {
    const customer = await repository.createCustomer(data);
    return { success: true, message: "Customer created successfully", customer };
  } catch (err) {
    console.error("createCustomer error:", err);
    return { success: false, message: err.message };
  }
}
 
 
// ============================================================
//  payment.service.js
// ============================================================
 
async function markPayment(data) {
  try {
    const result = await repository.markPayment(data);
    return { success: true, message: "Payment recorded successfully", ...result };
  } catch (err) {
    console.error("markPayment error:", err);
    return { success: false, message: err.message };
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

async function getExpenseDetails(params) {
  try {
    const data = await repository.getExpenseById(params);
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

async function getExpenseById(params) {
  try {
    const data = await repository.getExpenseById(params);
    return { success: true, data };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function getPurchaseById(purchaseId) {
  try {
    const purchaseData = await repository.getPurchaseById(purchaseId);  
    return {
      success: true,
      data: purchaseData,
    };
  } catch (error) {
    console.error("Purchase Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
  }
}


async function getExpenseReportServices(
  zodu_id,
  branch_id,
  page = 1,
  limit = 10,
  filtered_type,
  start_date,
  end_date,
  year
) {
  try {
    const ReportData = await repository.get_expense_report(
      zodu_id,
      branch_id,
      page,
      limit,
      filtered_type,
      start_date,
      end_date,
      year
    );
    if (!ReportData) {
      return {
        success: false,
        message: "Report Data Not Found"
      };
    }
    const overall = ReportData.overall_summary || {};
    return {
      success: true,
      data: ReportData.rows || [],
      datewise_summary: ReportData.datewise_summary || [],
      monthly_summary: ReportData.monthly_summary || [],
      allYear: ReportData.allYear || [],  // ADD THIS LINE
      totalBills: Number(overall.totalBills || 0),
      totalAmount: Number(overall.totalAmount || 0),
      totalPaid: Number(overall.totalPaid || 0),
      totalUnpaid: Number(overall.totalUnpaid || 0),
      totalItems: Number(overall.totalItems || 0),
      pagination: ReportData.pagination || {
        page,
        limit,
        totalRecords: 0,
        totalPages: 0
      }
    };
  } catch (err) {
    console.error("Error getting report data:", err);
    return {
      success: false,
      message: err.message
    };
  }
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

async function getPurchaseById(purchaseId) {
  try {
    const purchaseData = await repository.getPurchaseById(purchaseId);  
    return {
      success: true,
      data: purchaseData,
    };
  } catch (error) {
    console.error("Purchase Data getting Error", error);
    return {
      success: false,
      message: error.message,
    };
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
    console.log(start_date,end_date,filterType);
    const { startDate, endDate } = await getDateRange(
      filterType,
      start_date,
      end_date
    );

    const repoResult = await repository.getPurchaseSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      options,
      
    );

    if (!repoResult?.success) {
      return { success: false, message: "No purchase data found" };
    }

    return {
      success: true,
      message: "Purchase summary fetched successfully",
      data: repoResult.data,
      pagination: repoResult.pagination,
    };
  } catch (error) {
    console.error("Service Error (getPurchaseSummary):", error);
    return { success: false, message: error.message };
  }
}



/* ================= EXPENSE SUMMARY ================= */

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

    const repoResult = await repository.getExpenseSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      options
    );

    if (!repoResult?.success) {
      return { success: false, message: "No expense data found" };
    }

    return {
      success: true,
      message: "Expense summary fetched successfully",
      data: repoResult.data,
      pagination: repoResult.pagination,
    };
  } catch (error) {
    console.error("Service Error (getExpenseSummary):", error);
    return { success: false, message: error.message };
  }
}

// --- Inventory Summary ---
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
      search = "",
      stockFilter = "all" // all | available | low | used
    } = options;

    const repoResult = await repository.getInventorySummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      {
        page,
        limit,
        sortBy,
        sortOrder,
        search,
        stockFilter
      }
    );

    if (!repoResult?.success) {
      return {
        success: false,
        message: repoResult?.message || "No inventory data found"
      };
    }

    return {
      success: true,
      message: "Inventory summary fetched successfully",
      data: repoResult.data,
      pagination: repoResult.pagination
    };

  } catch (error) {
    console.error("Service Error (getInventorySummary):", error);
    return { success: false, message: error.message };
  }
}



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
      summaryType = "all",
      search = "",
      reportView = "normal",
      year
    } = options;

    const reportData = await repository.getOrdersSummary(
      zodu_id,
      branch_id,
      startDate,
      endDate,
      {
        page,
        limit,
        sortBy,
        sortOrder,
        top,
        summaryType,
        search,
        reportView,
        year
      }
    );

    if (!reportData?.success) {
      return {
        success: false,
        message: reportData?.message || "No data found",
      };
    }

    /* ===============================
       ✅ MONTHWISE / YEARWISE (FIXED)
    =============================== */
    if (reportView === "monthwise" || reportView === "yearwise") {
      return {
        success: true,
        message: "Orders report fetched successfully",
        data: reportData.data,
        pagination: reportData.pagination || {
          page,
          limit,
          totalRecords: 0,
          totalPages: 0,
        },
      };
    }

    /* ===============================
       NORMAL SUMMARY (EXISTING FLOW)
    =============================== */
    const raw = reportData.data;

    let responseData = {};

    if (summaryType === "category") {
      responseData = {
        total_orders: raw.total_orders || 0,
        total_amount: raw.total_amount || 0,
        total_quantity: raw.total_quantity || 0,
        category_wise_summary: raw.category_wise_summary || [],
      };
    } else {
      responseData = {
        total_orders: raw.total_orders || 0,
        total_amount: raw.total_amount || 0,
        total_quantity: raw.total_quantity || 0,
        orders: raw.orders || [],
        category_wise_summary: raw.category_wise_summary || [],
      };
    }

    return {
      success: true,
      message: "Orders summary fetched successfully",
      data: responseData,
      pagination: reportData.pagination || {
        page,
        limit,
      },
    };
  } catch (error) {
    console.error("Service Error (getOrdersSummary):", error);
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




async function markSalePayment (payload) {

  const {
    zodu_id,
    branch_id,
    sale_id,
    total_amount,
    paid_amount,
    payment_mode,
    paid_date,
    transaction_id,
  } = payload;

  // 1️⃣ check payment record
  let payment = await repository.getPaymentBySource(
    zodu_id,
    branch_id,
    sale_id
  );

  // 2️⃣ create payment summary if not exists
  if (!payment) {
    payment = await repository.createPayment({
      zodu_id,
      branch_id,
      source_id: sale_id,
      total_amount,
    });
  }

  if (!transaction_id || transaction_id.trim() === "") {
  transaction_id = null;
}
  // 3️⃣ insert payment history
  await repository.insertPaymentHistory({
    payment_id: payment.payment_id,
    paid_amount,
    paid_date,
    payment_mode,
    transaction_id ,
  });

  // 4️⃣ update payment summary
  await repository.updatePaymentAmount(payment.payment_id, paid_amount);

  // 5️⃣ update sales table
  await repository.updateSalePayment(sale_id, paid_amount);

  return {
    success: true,
    message: "Payment recorded successfully",
  };
};





// Export all functions
module.exports = {
  getReportServices,
  getPurchaseReportServices,
  createCompanyService,
  getData,
  createBranch,
  createProduct,
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
  makePayment,
  deleteHoldMenu,
  getExpenseById,
  getPurchaseById,
  getSingleOrder,
  getReportCategory,
  getExpenseReportServices,
  getSalesHistory,
  getSaleById,
  markSalePayment,
  getCustomers,
  getCustomerById,
  createCustomer,
  markPayment,
  updateOrder
};
