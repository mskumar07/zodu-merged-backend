const moment = require("moment");

async function getDateRange(filterType, start_date, end_date) {
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
      startDate = moment().subtract(6, "days").startOf("day");
      endDate = moment().endOf("day");
  }

  return {
    startDate: startDate.format("YYYY-MM-DD"),
    endDate: endDate.format("YYYY-MM-DD"),
  };
}


module.exports = {getDateRange};