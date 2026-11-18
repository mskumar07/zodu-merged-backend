const ExcelJS = require('exceljs');
const repo = require('../repository/holiday-repo');
const { httpError } = require('../utils/http-error');
const { istToday } = require('../utils/ist');

// Holidays of a branch: what Leave → Holidays lists, adds, edits, deletes and exports. (The Excel import is
// leave-service's importHolidays, which writes the same table.)
//   - one holiday per date in a branch;
//   - a holiday is removed for real: nothing points at it;
//   - applicability by department is stored but not enforced until the employees have departments.

const PG = { UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514' };
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const currentYear = () => Number(istToday().slice(0, 4));
const yearRange = (year) => ({ from: `${year}-01-01`, to: `${year + 1}-01-01` });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (iso) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** The rules between fields, checked on the whole row. The type is stored as sent. */
function settle(h) {
  const row = { ...h };

  const year = Number(row.holiday_date.slice(0, 4));
  if (year < YEAR_MIN || year > YEAR_MAX) throw httpError(400, `The date must be between ${YEAR_MIN} and ${YEAR_MAX}`);

  if (row.applicable_to === 'DEPARTMENTS') {
    if (!row.department_ids.length) throw httpError(400, 'Select at least one department');
  } else {
    row.department_ids = [];
  }
  return row;
}

/** Turns the database's refusals into answers the screen can show. */
function translate(err, row) {
  if (err.code === PG.UNIQUE_VIOLATION) return httpError(409, `A holiday is already added on ${prettyDate(row.holiday_date)}`);
  if (err.code === PG.CHECK_VIOLATION) return httpError(400, 'These holiday settings are not allowed');
  return err;
}

const notFound = () => httpError(404, 'Holiday not found');

/** The year's holidays for the table, with the counts for the left-hand list in the same answer. */
exports.list = async ({ zodu_id, branch_id, year = currentYear(), type, search }) => {
  const range = { zodu_id, branch_id, ...yearRange(year) };
  const [items, perType] = await Promise.all([
    repo.list({ ...range, type: type || null, search }),
    repo.counts(range),
  ]);
  const counts = {
    all: perType.reduce((sum, t) => sum + t.count, 0),
    by_type: Object.fromEntries(perType.map((t) => [t.type, t.count])),
  };
  return { success: true, year, counts, data: items };
};

exports.get = async ({ zodu_id, branch_id, holiday_id }) => {
  const row = await repo.findById({ zodu_id, branch_id, holiday_id });
  if (!row) throw notFound();
  return { success: true, data: row };
};

exports.create = async (input) => {
  const row = settle(input);
  try {
    return { success: true, data: await repo.insert(row) };
  } catch (err) {
    throw translate(err, row);
  }
};

exports.update = async ({ zodu_id, branch_id, holiday_id, ...change }) => {
  const current = await repo.findById({ zodu_id, branch_id, holiday_id });
  if (!current) throw notFound();

  // Only what was sent changes; the rest of the row stays as it is.
  const row = settle({ ...current, ...change, zodu_id, branch_id, holiday_id });
  try {
    const saved = await repo.update(row);
    if (!saved) throw notFound();          // deleted by someone else in between
    return { success: true, data: saved };
  } catch (err) {
    throw translate(err, row);
  }
};

exports.remove = async ({ zodu_id, branch_id, holiday_id }) => {
  const row = await repo.remove({ zodu_id, branch_id, holiday_id });
  if (!row) throw notFound();
  return { success: true, message: 'Holiday deleted', data: row };
};

/**
 * The year's holidays as an .xlsx. The Date / Holiday Name / Type columns are the ones the import reads, so a
 * downloaded sheet can be edited and uploaded again (Day and Applicable To are for reading and are ignored there).
 */
exports.exportSheet = async ({ zodu_id, branch_id, year = currentYear() }) => {
  const items = await repo.list({ zodu_id, branch_id, ...yearRange(year) });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Holidays ${year}`);
  sheet.columns = [
    { header: 'Date',           key: 'date', width: 14, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Day',            key: 'day',  width: 8 },
    { header: 'Holiday Name',   key: 'name', width: 36 },
    { header: 'Type',           key: 'type', width: 14 },
    { header: 'Applicable To',  key: 'who',  width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const h of items) {
    sheet.addRow({
      date: new Date(`${h.holiday_date}T00:00:00Z`),   // a real date cell, read back by the import as that day
      day: h.day, name: h.name, type: h.type, who: h.applicable_label,
    });
  }
  return { year, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
};
