const repository = require("../repository/orders-repo");
const kotService = require("./kot-service");

async function getReportCategory(zodu_id, branch_id, page = 1, limit = 10, search = "", from_date = "", to_date = "") {
  try {
    const reportData = await repository.get_category_item_wise_report(zodu_id, branch_id, page, limit, search, from_date, to_date);
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
      totalOrders: Number(ReportData.totals?.all_orders_total || 0),
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

// The per-counter kitchen tickets for what this request changed on the order.
function kitchenTickets(orderData, mode, public_order_no = null) {
  return kotService.generateTicketsForOrder({
    zodu_id: orderData.zodu_id,
    branch_id: orderData.branch_id,
    api_order_id: orderData.api_order_id,
    order_type: orderData.order_type,
    table_no: orderData.table_no,
    customer_name: orderData.customer_name,
    customer_phone: orderData.customer_phone,
    delivery_address: orderData.delivery_address,
    waiter_name: orderData.waiter_name,
    covers: orderData.covers,
    items: orderData.items,
    mode,
    public_order_no,
  });
}

async function createOrder(orderData) {
  try {
    if (orderData.order_type === "Dine-In") {
      const tmpOrder = await repository.createtmpOrder(orderData);
      orderData.api_order_id = tmpOrder.api_order_id;
      orderData.legacy_order_ref = tmpOrder.legacy_order_ref;
      await repository.createtmpOrderedItems(orderData);
      await repository.createKOT(orderData);
      // A second send to an occupied table lands on the same running order, so
      // "add" turns these into ADD tickets once the order has any.
      const { kot, kot_error } = await kitchenTickets(orderData, "add");
      return { success: true, message: "Running order created", order: tmpOrder, kot, kot_error };
    }

    // Order, ordered items, stock ledger + inventory, and KOT list rows all
    // run in one transaction — a failure at any step rolls back all of them.
    const finalOrder = await repository.createOrderWithKOT(orderData);
    orderData.api_order_id = finalOrder.api_order_id;
    const { kot, kot_error } = await kitchenTickets(orderData, "add", finalOrder.public_order_no);
    return { success: true, message: "Order created successfully", order: finalOrder, kot, kot_error };
  } catch (err) {
    console.error("Order Error:", err);
    return { success: false, message: err.message };
  }
}

async function updateOrder(orderData) {
  try {
    if (orderData.order_type !== "Dine-In") {
      return { success: false, message: "Only Dine-In orders can be updated" };
    }

    const tmpOrder = await repository.updatetmpOrder(orderData);
    orderData.legacy_order_ref = tmpOrder.legacy_order_ref;
    await repository.reconciletmpOrderedItems(orderData);
    await repository.updateKOT(orderData);
    // `items` is the order's full state here: raised quantities become ADD
    // tickets, lowered or removed ones CANCEL tickets.
    const { kot, kot_error } = await kitchenTickets(orderData, "reconcile");
    return { success: true, message: "Running order updated", order: tmpOrder, kot, kot_error };
  } catch (err) {
    console.error("Order Update Error:", err);
    return { success: false, message: err.message };
  }
}

async function getKotList(zodu_id, branch_id) {
  try {
    const data = await repository.getKotList(zodu_id, branch_id);
    return { success: true, data };
  } catch (error) {
    console.error("getKotList Error", error);
    return { success: false, message: error.message };
  }
}

async function markKotOrderReady(zodu_id, branch_id, api_order_id) {
  try {
    const removedItems = await repository.markKotOrderReady(zodu_id, branch_id, api_order_id);
    return { success: true, removedItems };
  } catch (error) {
    console.error("markKotOrderReady Error", error);
    return { success: false, message: error.message };
  }
}

module.exports = {
  getReportCategory, getReportServices, getSingleOrder, get_ordered_data,
  createOrder, updateOrder, getKotList, markKotOrderReady,
};
