const moment = require("moment");

function validateDateFilter(filterType, start_date, end_date) {
  const validFilters = ["today", "week", "month", "year", "custom"];

  // Validate filterType
  if (filterType && !validFilters.includes(filterType)) {
    return { valid: false, message: "Invalid filterType" };
  }

  let startDate, endDate;

  switch (filterType) {
    case "today":
      startDate = moment().startOf("day").format("YYYY-MM-DD");
      endDate = moment().endOf("day").format("YYYY-MM-DD");
      break;

    case "week":
      startDate = moment().startOf("week").format("YYYY-MM-DD");
      endDate = moment().endOf("week").format("YYYY-MM-DD");
      break;

    case "month":
      startDate = moment().startOf("month").format("YYYY-MM-DD");
      endDate = moment().endOf("month").format("YYYY-MM-DD");
      break;

    case "year":
      startDate = moment().startOf("year").format("YYYY-MM-DD");
      endDate = moment().endOf("year").format("YYYY-MM-DD");
      break;

    case "custom":
      if (!start_date || !end_date) {
        return {
          valid: false,
          message: "start_date and end_date are required for custom filter",
        };
      }

      if (
        !moment(start_date, "YYYY-MM-DD", true).isValid() ||
        !moment(end_date, "YYYY-MM-DD", true).isValid()
      ) {
        return { valid: false, message: "Invalid date format. Use YYYY-MM-DD" };
      }

      if (moment(start_date).isAfter(moment(end_date))) {
        return { valid: false, message: "start_date cannot be after end_date" };
      }

      startDate = start_date;
      endDate = end_date;
      break;

    default:
      // If filterType not provided, use current day
      startDate = moment().startOf("day").format("YYYY-MM-DD");
      endDate = moment().endOf("day").format("YYYY-MM-DD");
  }

  return { valid: true, startDate, endDate };
}

module.exports = { validateDateFilter };
