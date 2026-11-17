const ExcelJS = require('exceljs');

// Reads the holiday sheet an admin uploads (.xlsx). Pure: it takes the file's bytes and returns the
// rows and every problem found, so nothing is saved unless the whole sheet is good.
//
//   Date            2026-12-25 | 25-12-2026 | 25/12/2026 | 25 Dec 2026 | an Excel date cell
//   Holiday Name    up to 100 characters ("Name" also works as the heading)
//   Type            Gazetted Holiday | Company Holiday   (optional: left empty it is a Company Holiday)
//
// The first sheet is used; the first row holds the headings, in any order and case.

const MAX_ROWS = 500;
const MAX_ERRORS = 50;
const NAME_MAX = 100;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
const ZIP_MAGIC = 0x04034b50;          // "PK\x03\x04": every .xlsx is a zip

const HEADINGS = {
  date: ['date', 'holiday date'],
  name: ['holiday name', 'name', 'holiday'],
  type: ['type', 'holiday type'],
};
const TYPES = new Map([
  ['gazetted holiday', 'Gazetted Holiday'], ['gazetted', 'Gazetted Holiday'],
  ['company holiday', 'Company Holiday'],   ['company', 'Company Holiday'],
]);
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "YYYY-MM-DD" for a real calendar day in range, else null. */
function isoDate(y, m, d) {
  if (y < YEAR_MIN || y > YEAR_MAX) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** An Excel cell (date, serial number or text) -> "YYYY-MM-DD", or null if it isn't a date. */
function toIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === 'number') {
    // Excel serial day (1900 system): 25569 is 1970-01-01.
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) return isoDate(+m[1], +m[2], +m[3]);           // 2026-12-25
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text))) return isoDate(+m[3], +m[2], +m[1]);  // 25-12-2026 (day first)
  if ((m = /^(\d{1,2})[\s\-,]+([A-Za-z]{3,9})[\s\-,]+(\d{4})$/.exec(text))) {                           // 25 Dec 2026
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return month ? isoDate(+m[3], month, +m[1]) : null;
  }
  return null;
}

/** The text of a cell, whatever it holds (rich text, formula, link, number). */
function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('').trim();
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    return '';
  }
  return String(value).trim();
}

/** A formula cell holds { result }: use that where a date is wanted. */
const cellValue = (value) => (value && typeof value === 'object' && !(value instanceof Date) && 'result' in value ? value.result : value);

const columnOf = (headerRow, names) => {
  for (let c = 1; c <= headerRow.cellCount; c += 1) {
    if (names.includes(cellText(headerRow.getCell(c).value).toLowerCase())) return c;
  }
  return 0;
};

/**
 * @returns {Promise<{ rows: {date: string, name: string, type: string}[], errors: {row: number, message: string}[] }>}
 *          `row` is the row number in the sheet (the headings are row 1); 0 means the file itself.
 */
async function parseHolidaySheet(buffer) {
  const fileError = (message) => ({ rows: [], errors: [{ row: 0, message }] });

  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt32LE(0) !== ZIP_MAGIC) {
    return fileError('This is not an Excel (.xlsx) file.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return fileError('The Excel file could not be read.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return fileError('The sheet has no holidays in it.');

  const header = sheet.getRow(1);
  const dateCol = columnOf(header, HEADINGS.date);
  const nameCol = columnOf(header, HEADINGS.name);
  const typeCol = columnOf(header, HEADINGS.type);
  if (!dateCol || !nameCol) return fileError('The first row must have the headings "Date" and "Holiday Name" (and optionally "Type").');
  if (sheet.rowCount - 1 > MAX_ROWS * 2) return fileError(`A sheet can hold at most ${MAX_ROWS} holidays.`);

  const rows = [];
  const errors = [];
  const seen = new Map();   // date -> the row that first had it
  const fail = (row, message) => { if (errors.length < MAX_ERRORS) errors.push({ row, message }); };

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const rawDate = cellValue(row.getCell(dateCol).value);
    const name = cellText(row.getCell(nameCol).value);
    const typeText = typeCol ? cellText(row.getCell(typeCol).value) : '';
    if (rawDate == null && !name && !typeText) continue;         // blank row

    if (rows.length >= MAX_ROWS) { fail(r, `A sheet can hold at most ${MAX_ROWS} holidays.`); break; }

    const date = toIsoDate(rawDate);
    const type = typeText ? TYPES.get(typeText.toLowerCase()) : 'Company Holiday';
    let ok = true;
    if (!date)        { fail(r, 'The date is missing or not a valid date (use 2026-12-25 or 25-12-2026).'); ok = false; }
    if (!name)        { fail(r, 'The holiday name is missing.'); ok = false; }
    else if (name.length > NAME_MAX) { fail(r, `The holiday name is longer than ${NAME_MAX} characters.`); ok = false; }
    if (!type)        { fail(r, 'The type must be "Gazetted Holiday" or "Company Holiday".'); ok = false; }
    if (ok && seen.has(date)) { fail(r, `The date ${date} is already on row ${seen.get(date)}.`); ok = false; }

    if (ok) { seen.set(date, r); rows.push({ date, name, type }); }
  }

  if (!errors.length && !rows.length) return fileError('The sheet has no holidays in it.');
  return { rows: errors.length ? [] : rows, errors };
}

module.exports = { parseHolidaySheet, toIsoDate, MAX_ROWS };
