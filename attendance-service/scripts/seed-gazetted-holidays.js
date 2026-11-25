// Seeds the Central Government gazetted holidays into tbl_holidays for every branch.
//
//   node scripts/seed-gazetted-holidays.js                 every branch in employee-service's tbl_employees
//   node scripts/seed-gazetted-holidays.js Z072:B1 Z042:B1  only these company:branch pairs
//   node scripts/seed-gazetted-holidays.js --dry-run       print what would be added, write nothing
//
// Sources:
//   2026  "List of Gazetted Holidays during the year 2026 for administrative offices of Central
//         Government located in Chennai" (CGEWCC Chennai, per DoPT No. 12/2/2023-JCA dated 03/07/2025),
//         published by CAG: cag.gov.in/uploads/media/closed-holidays-2026-069d8a7adbcbbf0-13268503.pdf
//   2027  DoPT O.M. F.No.12/2/2023-JCA dated 16/07/2026, Annexure-I (Central Government offices at
//         Delhi / New Delhi). The Chennai list for 2027 had not been published when this was written;
//         replace these with it once it is.
// Id-ul-Fitr, Id-ul-Zuha, Muharram and Id-e-Milad may move with the moon sighting (DoPT para 5).
//
// Safe to re-run: a branch keeps one holiday per date (uq_holidays_branch_date) and a date that already
// has a holiday is left alone, so a holiday a company added or renamed itself is never overwritten.
// Reads DB_* from attendance-service/.env; the branch list from the employee-service database
// (EMPLOYEE_DB_NAME, default "employee-service", same server and credentials).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const TYPE = 'Gazetted Holiday';

const HOLIDAYS = [
  // 2026 — Chennai
  ['2026-01-15', 'Pongal'],
  ['2026-01-26', 'Republic Day'],
  ['2026-03-21', "Idu'l Fitr (Ramzan)"],
  ['2026-03-31', 'Mahavir Jayanti'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-01', 'Buddha Purnima'],
  ['2026-05-28', "Idu'l Zuha (Bakrid)"],
  ['2026-06-26', 'Muharram'],
  ['2026-08-15', 'Independence Day'],
  ['2026-08-26', "Prophet Mohammad's Birthday (Id-e-Milad)"],
  ['2026-09-14', 'Ganesh Chaturthi / Vinayak Chaturthi'],
  ['2026-10-02', "Mahatma Gandhi's Birthday"],
  ['2026-10-19', 'Dussehra / Maha Ashtami (additional)'],
  ['2026-10-20', 'Dussehra (Vijaya Dashami)'],
  ['2026-11-08', 'Diwali (Deepavali)'],
  ['2026-11-24', "Guru Nanak's Birthday"],
  ['2026-12-25', 'Christmas Day'],
  // 2027 — DoPT, Delhi / New Delhi
  ['2027-01-26', 'Republic Day'],
  ['2027-03-10', 'Id-ul-Fitr'],
  ['2027-03-23', 'Holi'],
  ['2027-03-26', 'Good Friday'],
  ['2027-04-15', 'Ram Navami'],
  ['2027-04-19', 'Mahavir Jayanti'],
  ['2027-05-17', 'Id-ul-Zuha (Bakrid)'],
  ['2027-05-20', 'Buddha Purnima'],
  ['2027-06-16', 'Muharram'],
  // One holiday per date per branch: both occasions share 15 Aug 2027.
  ['2027-08-15', 'Independence Day / Milad-un-Nabi'],
  ['2027-08-25', 'Janmashtami (Vaishnav)'],
  ['2027-10-02', "Mahatma Gandhi's Birthday"],
  ['2027-10-09', 'Dussehra (Vijaya Dashami)'],
  ['2027-10-29', 'Diwali (Deepavali)'],
  ['2027-11-14', "Guru Nanak's Birthday"],
  ['2027-12-25', 'Christmas Day'],
];

const SCOPE = /^[A-Za-z0-9_-]{1,50}$/;

const client = (database) => new Client({
  host: process.env.DB_HOSTNAME,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database,
});

async function branchesFromEmployees() {
  const db = client(process.env.EMPLOYEE_DB_NAME || 'employee-service');
  await db.connect();
  try {
    const { rows } = await db.query('SELECT DISTINCT zodu_id, branch_id FROM tbl_employees ORDER BY 1, 2');
    return rows;
  } finally {
    await db.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pairs = args.filter((a) => !a.startsWith('--')).map((a) => {
    const [zodu_id, branch_id] = a.split(':');
    if (!SCOPE.test(zodu_id || '') || !SCOPE.test(branch_id || '')) throw new Error(`Bad branch "${a}", expected ZODU:BRANCH`);
    return { zodu_id, branch_id };
  });
  const branches = pairs.length ? pairs : await branchesFromEmployees();
  if (!branches.length) return console.log('No branches found.');

  const db = client(process.env.DB_NAME);
  await db.connect();
  let added = 0;
  try {
    await db.query('BEGIN');
    for (const { zodu_id, branch_id } of branches) {
      // One statement per branch: every holiday, skipping dates the branch already has.
      const { rowCount } = await db.query(
        `INSERT INTO tbl_holidays (zodu_id, branch_id, holiday_date, name, holiday_type, applicable_to, department_ids)
         SELECT $1, $2, h.d::date, h.n, $3, 'ALL', '{}'
           FROM unnest($4::text[], $5::text[]) AS h(d, n)
         ON CONFLICT (zodu_id, branch_id, holiday_date) DO NOTHING`,
        [zodu_id, branch_id, TYPE, HOLIDAYS.map((h) => h[0]), HOLIDAYS.map((h) => h[1])],
      );
      added += rowCount;
      console.log(`${zodu_id}/${branch_id}: ${rowCount} added, ${HOLIDAYS.length - rowCount} already there`);
    }
    if (dryRun) {
      await db.query('ROLLBACK');
      console.log(`Dry run: would add ${added} holidays across ${branches.length} branches. Nothing written.`);
    } else {
      await db.query('COMMIT');
      console.log(`Added ${added} holidays across ${branches.length} branches.`);
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
