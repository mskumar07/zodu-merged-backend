const repository = require("../repository/orders-repo");

async function getReportCategory(zodu_id, branch_id, page = 1, limit = 10, search = "") {
  try {
    const reportData = await repository.get_category_item_wise_report(zodu_id, branch_id, page, limit, search);
    if (!reportData) return { success: false, message: "Category Report Data Not Found" };
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
    return { success: false, message: err.message };
  }
}

async function getReportServices(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year, search) {
  try {
    const ReportData = await repository.get_all_report_data(zodu_id, branch_id, page, limit, filtered_type, start_date, end_date, year, search);
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
      pagination: { page, limit, totalRecords: totalCount, totalPages },
    };
  } catch (err) {
    console.error("Error getting report data:", err);
    return { success: false, message: err.message };
  }
}

async function getSingleOrder(zodu_id, branch_id, api_order_id) {
  try {
    return await repository.getSingleOrder(zodu_id, branch_id, api_order_id);
  } catch (error) {
    console.error("getSingleOrder error:", error);
    throw new Error(error.message);
  }
}

async function get_ordered_data(branch_id, zodu_id) {
  try {
    const orderData = await repository.get_ordered_data(branch_id, zodu_id);
    return { success: true, data: orderData };
  } catch (error) {
    console.error("get_ordered_data Error", error);
    return { success: false, message: error.message };
  }
}

async function createOrder(orderData) {
  try {
    if (orderData.order_type === "Dine-In") {
      const tmpOrder = await repository.createtmpOrder(orderData);
      orderData.api_order_id = tmpOrder.api_order_id;
      orderData.legacy_order_ref = tmpOrder.legacy_order_ref;
      await repository.createtmpOrderedItems(orderData);
      await repository.createKOT(orderData);
      return { success: true, message: "Running order created", order: tmpOrder };
    }

    const finalOrder = await repository.createOrder(orderData);
    orderData.api_order_id = finalOrder.api_order_id;
    await repository.createOrderedItems(orderData);
    return { success: true, message: "Order created successfully", order: finalOrder };
  } catch (err) {
    console.error("Order Error:", err);
    return { success: false, message: err.message };
  }
}

module.exports = { getReportCategory, getReportServices, getSingleOrder, get_ordered_data, createOrder };
