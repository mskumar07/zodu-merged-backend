const conn = require("../database/connection");
const authClient = require("../utils/authClient");

const BRANCH_SELECT = `
  SELECT
    b.*,
    a.address_line_1,
    a.address_line_2,
    a.address_line_1 AS building_no,
    a.address_line_2 AS area_street_name,
    a.city,
    a.district,
    a.state,
    a.pincode,
    bd.bank_name,
    bd.bank_branch,
    bd.holder_name,
    bd.account_number,
    bd.account_type,
    bd.ifsc_code
  FROM tbl_branch b
  LEFT JOIN tbl_address     a  ON a.id  = b.address_id
  LEFT JOIN tbl_bank_details bd ON bd.id = b.bank_details_id
`;

exports.getBranches = async (zodu_id, branch_id = null) => {
  const params = [zodu_id];
  let query = `${BRANCH_SELECT} WHERE b.zodu_id = $1`;

  if (branch_id) {
    params.push(branch_id);
    query += ` AND b.branch_id = $2`;
  }

  query += ` ORDER BY b.branch_id ASC`;

  const result = await conn.query(query, params);
  return result.rows;
};

exports.getBranchByIds = async (zodu_id, branch_id) => {
  const result = await conn.query(
    `${BRANCH_SELECT}
     WHERE b.zodu_id = $1 AND b.branch_id = $2
     LIMIT 1`,
    [zodu_id, branch_id]
  );
  return result.rows[0] || null;
};

exports.updateBranch = async (zodu_id, branch_id, fields) => {
  if (Object.keys(fields).length === 0) return null;

  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // ── 0. Extract reuse flags ──────────────────────────────────────────────
    const use_same_address_as_company = fields.use_same_address_as_company;
    const use_same_bank_as_company = fields.use_same_bank_as_company;
    
    // Remove flags from fields object as they're not DB columns
    delete fields.use_same_address_as_company;
    delete fields.use_same_bank_as_company;

    // ── 1. Fetch current address_id / bank_details_id ────────────────────────
    const cur = await client.query(
      `SELECT address_id, bank_details_id FROM tbl_branch
       WHERE zodu_id = $1 AND branch_id = $2`,
      [zodu_id, branch_id]
    );
    const current = cur.rows[0];

    // ── 2. Split fields into buckets ─────────────────────────────────────────
    const addressMap = {
      address_line_1:   'address_line_1',
      address_line_2:   'address_line_2',
      building_no:      'address_line_1',
      area_street_name: 'address_line_2',
      branch_address_line_1: 'address_line_1',
      branch_address_line_2: 'address_line_2',
      branch_floor_building_no: 'address_line_1',
      branch_area_street_name: 'address_line_2',
      city:             'city',
      district:         'district',
      state:            'state',
      pincode:          'pincode',
      branch_city:      'city',
      branch_district:  'district',
      branch_state:     'state',
      branch_pincode:   'pincode',
    };
    const bankKeys    = ['bank_name', 'bank_branch', 'holder_name',
                         'account_number', 'account_type', 'ifsc_code'];
    const branchKeys  = ['branch_name', 'branch_manager', 'branch_manager_or_admin',
                         'branch_mobile_no', 'branch_mail_id', 'branch_image'];

    const addrFields = {};
    const bankFields = {};
    const branchFields = {};

    for (const [k, v] of Object.entries(fields)) {
      if (addressMap[k])             addrFields[addressMap[k]] = v;
      else if (bankKeys.includes(k)) bankFields[k] = v;
      else if (branchKeys.includes(k)) {
        const col = k === 'branch_manager_or_admin' ? 'branch_manager' : k;
        branchFields[col] = v;
      }
    }

    // ── 3. Handle Address with reuse flag ───────────────────────────────────
    let address_id = current?.address_id ?? null;
    
    if (use_same_address_as_company) {
      // Get company's address_id
      const companyRes = await client.query(
        `SELECT address_id FROM tbl_business WHERE zodu_id = $1`,
        [zodu_id]
      );
      if (companyRes.rows[0]?.address_id) {
        address_id = companyRes.rows[0].address_id;
        branchFields.address_id = address_id;
      }
    } else if (Object.keys(addrFields).length > 0) {
      // Update address with provided fields
      if (address_id) {
        const addrKeys = Object.keys(addrFields);
        const addrVals = Object.values(addrFields);
        const setClause = addrKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        await client.query(
          `UPDATE tbl_address SET ${setClause}, updated_at = now()
           WHERE id = $${addrKeys.length + 1}`,
          [...addrVals, address_id]
        );
      } else {
        const addrRes = await client.query(
          `INSERT INTO tbl_address (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            zodu_id,
            addrFields.address_line_1      ?? null,
            addrFields.address_line_2      ?? null,
            addrFields.city                ?? null,
            addrFields.district            ?? null,
            addrFields.state               ?? null,
            addrFields.pincode             ?? null,
          ]
        );
        address_id = addrRes.rows[0].id;
        branchFields.address_id = address_id;
      }
    }

    // ── 4. Handle Bank Details with reuse flag ──────────────────────────────
    let bank_details_id = current?.bank_details_id ?? null;
    
    if (use_same_bank_as_company) {
      // Get company's bank_details_id
      const companyRes = await client.query(
        `SELECT bank_details_id FROM tbl_business WHERE zodu_id = $1`,
        [zodu_id]
      );
      if (companyRes.rows[0]?.bank_details_id) {
        bank_details_id = companyRes.rows[0].bank_details_id;
        branchFields.bank_details_id = bank_details_id;
      }
    } else if (Object.keys(bankFields).length > 0) {
      // Update bank details with provided fields
      if (bank_details_id) {
        const bankKeyArr = Object.keys(bankFields);
        const bankValArr = Object.values(bankFields);
        const setClause  = bankKeyArr.map((k, i) => `${k} = $${i + 1}`).join(', ');
        await client.query(
          `UPDATE tbl_bank_details SET ${setClause}, updated_at = now()
           WHERE id = $${bankKeyArr.length + 1}`,
          [...bankValArr, bank_details_id]
        );
      } else {
        const bankRes = await client.query(
          `INSERT INTO tbl_bank_details (zodu_id, bank_name, bank_branch, holder_name, account_number, account_type, ifsc_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [zodu_id, bankFields.bank_name ?? null, bankFields.bank_branch ?? null,
           bankFields.holder_name ?? null, bankFields.account_number ?? null,
           bankFields.account_type ?? null, bankFields.ifsc_code ?? null]
        );
        bank_details_id = bankRes.rows[0].id;
        branchFields.bank_details_id = bank_details_id;
      }
    }

    // ── 5. Update tbl_branch ─────────────────────────────────────────────────
    let updated = null;
    if (Object.keys(branchFields).length > 0) {
      const branchKeyArr = Object.keys(branchFields);
      const branchValArr = Object.values(branchFields);
      const setClause    = branchKeyArr.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const res = await client.query(
        `UPDATE tbl_branch
         SET ${setClause}, updated_at = now()
         WHERE zodu_id = $${branchKeyArr.length + 1} AND branch_id = $${branchKeyArr.length + 2}
         RETURNING *`,
        [...branchValArr, zodu_id, branch_id]
      );
      updated = res.rows[0] || null;
    } else {
      // no branch-level fields changed — just return the current row
      const res = await client.query(
        `SELECT * FROM tbl_branch WHERE zodu_id = $1 AND branch_id = $2`,
        [zodu_id, branch_id]
      );
      updated = res.rows[0] || null;
    }

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Create branch with smart address/bank reuse logic ──────────────────────────
exports.createBranch = async (branchData) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // ── Fetch company's address + bank for reuse flags ──────────────────────
    const companyRes = await client.query(
      `SELECT address_id, bank_details_id FROM tbl_business WHERE zodu_id = $1`,
      [branchData.zodu_id]
    );
    const company = companyRes.rows[0];

    // ── ADDRESS: 3 resolution paths ─────────────────────────────────────────
    // 1. use_same_address_as_company → take company's address_id
    // 2. address_id passed directly  → reuse that existing row as-is
    // 3. address fields provided     → create a new tbl_address row
    let address_id = null;

    if (branchData.use_same_address_as_company && company?.address_id) {
      address_id = company.address_id;

    } else if (branchData.address_id) {
      address_id = branchData.address_id;

    } else {
      const line1 = branchData.address_line_1 ?? null;
      const line2 = branchData.address_line_2 ?? null;
      const city  = branchData.branch_city     ?? null;
      const dist  = branchData.branch_district ?? null;
      const state = branchData.branch_state    ?? null;
      const pin   = branchData.branch_pincode  ?? null;

      if (line1 || line2 || city || dist || state || pin) {
        const addrRes = await client.query(
          `INSERT INTO tbl_address
             (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [branchData.zodu_id, line1, line2, city, dist, state, pin]
        );
        address_id = addrRes.rows[0].id;
      }
    }

    // ── BANK: same 3 paths ───────────────────────────────────────────────────
    // 1. use_same_bank_as_company   → take company's bank_details_id
    // 2. bank_details_id passed     → reuse that existing row as-is
    // 3. bank fields provided       → create a new tbl_bank_details row
    let bank_details_id = null;

    if (branchData.use_same_bank_as_company && company?.bank_details_id) {
      bank_details_id = company.bank_details_id;

    } else if (branchData.bank_details_id) {
      bank_details_id = branchData.bank_details_id;

    } else {
      const accountNo = branchData.account_number ?? null;

      if (accountNo || branchData.bank_name || branchData.holder_name) {
        const bankRes = await client.query(
          `INSERT INTO tbl_bank_details
             (zodu_id, bank_name, bank_branch, holder_name, account_number, account_type, ifsc_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [
            branchData.zodu_id,
            branchData.bank_name   ?? null,
            branchData.bank_branch ?? null,
            branchData.holder_name ?? null,
            accountNo,
            branchData.account_type ?? null,
            branchData.ifsc_code    ?? null,
          ]
        );
        bank_details_id = bankRes.rows[0].id;
      }
    }

    // ── Insert branch ────────────────────────────────────────────────────────
    const { rows } = await client.query(
      `INSERT INTO tbl_branch
         (branch_id, zodu_id, branch_name, branch_manager,
          branch_mobile_no, branch_mail_id, branch_image,
          address_id, bank_details_id, qr_code_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
       RETURNING *`,
      [
        branchData.branch_id,
        branchData.zodu_id,
        branchData.branch_name                                ?? null,
        branchData.branch_manager ?? branchData.branch_manager_or_admin ?? null,
        branchData.branch_mobile_no ?? null,
        branchData.branch_mail_id   ?? null,
        branchData.branch_image     ?? null,
        address_id,
        bank_details_id,
        branchData.qr_code_id ?? null,
      ]
    );

    await client.query('COMMIT');

    // ── Seed default invoice settings via auth-service (source of truth) ───
    // Best-effort: branch creation already succeeded, so a settings-seed
    // failure here shouldn't fail the branch creation response. Settings
    // are self-healing anyway — upsertInvoiceSettings on first save creates
    // the row if it's missing.
    authClient
      .upsertInvoiceSettings(branchData.zodu_id, branchData.branch_id, {})
      .catch((err) => console.error('[branch-repo] seed invoice settings failed:', err.message));

    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error('Unable to create branch: ' + err.message);
  } finally {
    client.release();
  }
};