// The holiday sheet reader: pure (bytes in, rows and problems out), so it needs no database or token.
const ExcelJS = require('exceljs');
const { parseHolidaySheet, toIsoDate } = require('../src/utils/holiday-sheet');

const sheet = async (rows, headings = ['Date', 'Holiday Name', 'Type']) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Holidays');
  ws.addRow(headings);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('toIsoDate', () => {
  test('reads the date forms people type or Excel stores', () => {
    expect(toIsoDate('2026-12-25')).toBe('2026-12-25');
    expect(toIsoDate('25-12-2026')).toBe('2026-12-25');      // day first
    expect(toIsoDate('25/12/2026')).toBe('2026-12-25');
    expect(toIsoDate('5.1.2026')).toBe('2026-01-05');
    expect(toIsoDate('25 Dec 2026')).toBe('2026-12-25');
    expect(toIsoDate('25-December-2026')).toBe('2026-12-25');
    expect(toIsoDate(new Date(Date.UTC(2026, 11, 25)))).toBe('2026-12-25');
    expect(toIsoDate(46381)).toBe('2026-12-25');              // Excel serial day
  });

  test('refuses what is not a real date', () => {
    for (const bad of ['', 'x', '2026-02-30', '31-04-2026', '25 Foo 2026', '1999-12-31', '2101-01-01', null, undefined, true]) {
      expect(toIsoDate(bad)).toBeNull();
    }
  });
});

describe('parseHolidaySheet', () => {
  test('reads good rows; an empty Type means Company Holiday', async () => {
    const { rows, errors } = await parseHolidaySheet(await sheet([
      ['2026-01-26', 'Republic Day', 'Gazetted Holiday'],
      [new Date(Date.UTC(2026, 9, 2)), 'Gandhi Jayanti', 'gazetted'],
      ['31-12-2026', 'Year-End Day', ''],
      [null, null, null],                                    // a blank row is skipped
      ['2026-03-11', 'Company Day', 'COMPANY HOLIDAY'],
    ]));
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-01-26', name: 'Republic Day', type: 'Gazetted Holiday' },
      { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'Gazetted Holiday' },
      { date: '2026-12-31', name: 'Year-End Day', type: 'Company Holiday' },
      { date: '2026-03-11', name: 'Company Day', type: 'Company Holiday' },
    ]);
  });

  test('the headings can be in any order and case, and Type is optional', async () => {
    const { rows, errors } = await parseHolidaySheet(await sheet([['Pongal', '2026-01-14']], ['name', 'DATE']));
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ date: '2026-01-14', name: 'Pongal', type: 'Company Holiday' }]);
  });

  test('lists every problem with its sheet row, and saves nothing', async () => {
    const { rows, errors } = await parseHolidaySheet(await sheet([
      ['not a date', 'A', ''],                                // row 2
      ['2026-12-01', '', ''],                                 // row 3: no name
      ['2026-12-02', 'B', 'Weird'],                           // row 4: bad type
      ['2026-12-03', 'C', ''],                                // row 5: fine
      ['2026-12-03', 'Dup', ''],                              // row 6: same date as row 5
      ['2026-12-04', 'x'.repeat(101), ''],                    // row 7: name too long
    ]));
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 6, 7]);
    expect(errors[3].message).toMatch(/already on row 5/);
  });

  test('refuses a file that is not an .xlsx, and a sheet without the headings or rows', async () => {
    for (const buffer of [Buffer.from('plain text'), Buffer.alloc(0), await sheet([['2026-12-05', 'x']], ['When', 'What']), await sheet([])]) {
      const { rows, errors } = await parseHolidaySheet(buffer);
      expect(rows).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].row).toBe(0);
    }
  });
});
