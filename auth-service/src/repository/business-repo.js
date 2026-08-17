const conn = require('../database/connection');

// All tables (tbl_business, tbl_branch, tbl_address, tbl_bank_details) live in retail_auth_service DB

// ── COMPANY ───────────────────────────────────────────────────────────────────

exports.createCompany = async (data) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // 1. address
    let address_id = null;
    const line1 = data.address_line_1 ?? null;
    const line2 = data.address_line_2 ?? null;
    if (line1 || line2 || data.city || data.district || data.state || data.pincode) {
      const r = await client.query(
        `INSERT INTO tbl_address (zodu_id, address_line_1, address_line_2, city, district, state, pincode)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [data.zodu_id, line1, line2, data.city || null, data.district || null, data.state || null, data.pincode || null]
      );
      address_id = r.rows[0].id;
    }

    // 2. bank_details
    let bank_details_id = null;
    if (data.account_number) {
      const r = await client.query(
        `INSERT INTO tbl_bank_details (zodu_id, bank_name, bank_branch, holder_name, account_number, account_type, ifsc_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [data.zodu_id, data.bank_name || null, data.bank_branch || null,
         data.holder_name || null, data.account_number, data.account_type || null, data.ifsc_code || null]
      );
      bank_details_id = r.rows[0].id;
    }

    // 3. tbl_business — new companies get a 5-year subscription starting now;
    //    re-registering an existing zodu_id (ON CONFLICT) leaves the
    //    subscription window untouched.
    const r = await client.query(
      `INSERT INTO tbl_business
         (zodu_id, business_name, owner_admin_name, mobile_no, mail_id, gst_no, type, address_id, bank_details_id, status,
          is_subscripted, subscription_start_date, subscription_expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,
               true, now(), now() + INTERVAL '5 years')
       ON CONFLICT (zodu_id) DO UPDATE
         SET business_name    = EXCLUDED.business_name,
             owner_admin_name = EXCLUDED.owner_admin_name,
             mobile_no        = EXCLUDED.mobile_no,
             mail_id          = EXCLUDED.mail_id,
             gst_no           = EXCLUDED.gst_no,
             type             = COALESCE(EXCLUDED.type, tbl_business.type),
             address_id       = COALESCE(EXCLUDED.address_id, tbl_business.address_id),
             bank_details_id  = COALESCE(EXCLUDED.bank_details_id, tbl_business.bank_details_id),
             updated_at       = now()
       RETURNING *`,
      [data.zodu_id, data.restaurant_name || data.business_name,
       data.owner_admin_name || null, data.mobile_no || null, data.mail_id || null,
       data.gst_no || null, data.type || data.business_type || null, address_id, bank_details_id]
    );

    await client.query('COMMIT');
    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.updateCompany = async (zodu_id, fields) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT address_id, bank_details_id FROM tbl_business WHERE zodu_id = $1`, [zodu_id]
    );
    if (!cur.rows[0]) throw new Error('Company not found');
    const { address_id: curAddrId, bank_details_id: curBankId } = cur.rows[0];

    const addressCols = ['address_line_1', 'address_line_2', 'city', 'district', 'state', 'pincode'];
    const bankCols    = ['bank_name', 'bank_branch', 'holder_name', 'account_number', 'account_type', 'ifsc_code'];

    const addrFields = {}, bankFields = {}, compFields = {};
    for (const [k, v] of Object.entries(fields)) {
      if (addressCols.includes(k))   addrFields[k] = v;
      else if (bankCols.includes(k)) bankFields[k] = v;
      else                           compFields[k]   = v;
    }

    if ('restaurant_name' in compFields) {
      compFields.business_name = compFields.restaurant_name;
      delete compFields.restaurant_name;
    }

    // address update/insert
    if (Object.keys(addrFields).length > 0) {
      if (curAddrId) {
        const keys = Object.keys(addrFields), vals = Object.values(addrFields);
        await client.query(
          `UPDATE tbl_address SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}, updated_at=now() WHERE id=$${keys.length+1}`,
          [...vals, curAddrId]
        );
      } else {
        const r = await client.query(
          `INSERT INTO tbl_address (zodu_id,address_line_1,address_line_2,city,district,state,pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [zodu_id, addrFields.address_line_1||null, addrFields.address_line_2||null,
           addrFields.city||null, addrFields.district||null, addrFields.state||null, addrFields.pincode||null]
        );
        compFields.address_id = r.rows[0].id;
      }
    }
    // bank update/insert
    if (Object.keys(bankFields).length > 0 && bankFields.account_number) {
      if (curBankId) {
        const keys = Object.keys(bankFields), vals = Object.values(bankFields);
        await client.query(
          `UPDATE tbl_bank_details SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}, updated_at=now() WHERE id=$${keys.length+1}`,
          [...vals, curBankId]
        );
      } else {
        const r = await client.query(
          `INSERT INTO tbl_bank_details (zodu_id,bank_name,bank_branch,holder_name,account_number,account_type,ifsc_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [zodu_id, bankFields.bank_name||null, bankFields.bank_branch||null,
           bankFields.holder_name||null, bankFields.account_number,
           bankFields.account_type||null, bankFields.ifsc_code||null]
        );
        compFields.bank_details_id = r.rows[0].id;
      }
    }

    // business update
    let updated;
    if (Object.keys(compFields).length > 0) {
      const keys = Object.keys(compFields), vals = Object.values(compFields);
      const setQ = [...keys.map((k,i)=>`${k}=$${i+1}`), 'updated_at=now()'].join(',');
      const r = await client.query(
        `UPDATE tbl_business SET ${setQ} WHERE zodu_id=$${keys.length+1} RETURNING *`,
        [...vals, zodu_id]
      );
      updated = r.rows[0];
    } else {
      const r = await client.query(`SELECT * FROM tbl_business WHERE zodu_id=$1`, [zodu_id]);
      updated = r.rows[0];
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

exports.getCompany = async (zodu_id) => {
  console.log("Fetching company for zodu_id:", zodu_id);
  const r = await conn.query(
    `SELECT b.*,
            b.business_name AS restaurant_name,b.type AS business_type,
            TO_CHAR(b.subscription_start_date, 'FMDD Mon YYYY')  AS subscription_start_date,
            TO_CHAR(b.subscription_expiry_date, 'FMDD Mon YYYY') AS subscription_expiry_date,
            a.address_line_1, a.address_line_2,
            a.city, a.district, a.state, a.pincode,
            bd.bank_name, bd.bank_branch, bd.holder_name,
            bd.account_number, bd.account_type, bd.ifsc_code
     FROM tbl_business b
     LEFT JOIN tbl_address     a  ON a.id  = b.address_id
     LEFT JOIN tbl_bank_details bd ON bd.id = b.bank_details_id
     WHERE b.zodu_id = $1`,
    [zodu_id]
  );
  // console.log("Company query result:", r);
  return r.rows[0] || null;
};

exports.findMaxZoduId = async () => {
  const r = await conn.query('SELECT max(zodu_id) FROM tbl_business');
  return r.rows[0];
};

// ── BRANCH ────────────────────────────────────────────────────────────────────

exports.getBranches = async (zodu_id, branch_id = null) => {
  const params = [zodu_id];
  let query = `
    SELECT b.*,
           b.same_as_address, b.same_as_bank_details,
           a.address_line_1, a.address_line_2,
           a.city, a.district, a.state, a.pincode,
           bd.bank_name, bd.bank_branch, bd.holder_name,
           bd.account_number, bd.account_type, bd.ifsc_code
    FROM tbl_branch b
    LEFT JOIN tbl_address     a  ON a.id  = b.address_id
    LEFT JOIN tbl_bank_details bd ON bd.id = b.bank_details_id
    WHERE b.zodu_id = $1`;
  if (branch_id) {
    params.push(branch_id);
    query += ` AND b.branch_id = $2`;
  }
  query += ` ORDER BY b.branch_id ASC`;
  const r = await conn.query(query, params);
  return r.rows;
};

exports.createDefaultBranch = async ({ branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id }) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO tbl_branch (branch_id, zodu_id, qr_code_id, branch_name, branch_mobile_no, branch_mail_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [branch_id, zodu_id, qr_code_id || null, branch_name, branch_mobile_no || null, branch_mail_id || null]
    );

    await client.query(
      `INSERT INTO tbl_invoice_settings (zodu_id, branch_id)
       VALUES ($1, $2)
       ON CONFLICT (zodu_id, branch_id) DO NOTHING`,
      [zodu_id, branch_id]
    );

    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error('Unable to create default branch: ' + err.message);
  } finally {
    client.release();
  }
};

exports.createBranch = async (data) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    // Fetch company address+bank for reuse
    const compRes = await client.query(
      `SELECT address_id, bank_details_id FROM tbl_business WHERE zodu_id = $1`, [data.zodu_id]
    );
    const company = compRes.rows[0];

    // ADDRESS
    let address_id = null;
    if (data.use_same_address_as_company && company?.address_id) {
      address_id = company.address_id;
    } else if (data.address_id) {
      address_id = data.address_id;
    } else {
      const line1 = data.address_line_1 ?? null;
      const city  = data.branch_city     ?? null;
      const dist  = data.branch_district ?? null;
      const state = data.branch_state    ?? null;
      const pin   = data.branch_pincode  ?? null;
      if (line1 || city || dist || state || pin) {
        const r = await client.query(
          `INSERT INTO tbl_address (zodu_id,address_line_1,address_line_2,city,district,state,pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [data.zodu_id, line1, data.address_line_2??null, city, dist, state, pin]
        );
        address_id = r.rows[0].id;
      }
    }

    // BANK
    let bank_details_id = null;
    if (data.use_same_bank_as_company && company?.bank_details_id) {
      bank_details_id = company.bank_details_id;
    } else if (data.bank_details_id) {
      bank_details_id = data.bank_details_id;
    } else if (data.account_number || data.bank_name || data.holder_name) {
      const r = await client.query(
        `INSERT INTO tbl_bank_details (zodu_id,bank_name,bank_branch,holder_name,account_number,account_type,ifsc_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [data.zodu_id, data.bank_name??null, data.bank_branch??null,
         data.holder_name??null, data.account_number??null,
         data.account_type??null, data.ifsc_code??null]
      );
      bank_details_id = r.rows[0].id;
    }

    // INSERT tbl_branch
    const { rows } = await client.query(
      `INSERT INTO tbl_branch
         (branch_id, zodu_id, branch_name, branch_manager,
          branch_mobile_no, branch_mail_id, branch_image,
          address_id, bank_details_id, qr_code_id,
          same_as_address, same_as_bank_details, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
      [
        data.branch_id, data.zodu_id,
        data.branch_name ?? null,
        data.branch_manager ?? data.branch_manager_or_admin ?? null,
        data.branch_mobile_no ?? null,
        data.branch_mail_id   ?? null,
        data.branch_image     ?? null,
        address_id, bank_details_id,
        data.qr_code_id ?? null,
        data.use_same_address_as_company ?? data.same_as_address ?? false,
        data.use_same_bank_as_company ?? data.same_as_bank_details ?? false,
      ]
    );

    // ── Seed default invoice settings for this branch ──────────────────────
    await client.query(
      `INSERT INTO tbl_invoice_settings (zodu_id, branch_id)
       VALUES ($1, $2)
       ON CONFLICT (zodu_id, branch_id) DO NOTHING`,
      [data.zodu_id, data.branch_id]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error('Unable to create branch: ' + err.message);
  } finally {
    client.release();
  }
};

exports.updateBranch = async (zodu_id, branch_id, fields) => {
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    const use_same_address_as_company = fields.same_as_address;
    const use_same_bank_as_company    = fields.same_as_bank_details;
    console.log("Updating branch with fields:--------", fields, use_same_address_as_company, use_same_bank_as_company);
    delete fields.same_as_address;
    delete fields.same_as_bank_details;

    // Fetch branch's current address_id/bank_details_id AND company's to detect sharing
    const cur = await client.query(
      `SELECT b.address_id, b.bank_details_id,
              c.address_id AS company_address_id, c.bank_details_id AS company_bank_details_id
       FROM tbl_branch b
       JOIN tbl_business c ON c.zodu_id = b.zodu_id
       WHERE b.zodu_id=$1 AND b.branch_id=$2`,
      [zodu_id, branch_id]
    );
    const current = cur.rows[0];

    // true when the branch currently shares the company's row
    const isAddressShared = current?.address_id      && current.address_id      === current.company_address_id;
    const isBankShared    = current?.bank_details_id && current.bank_details_id === current.company_bank_details_id;

    const addressMap = {
      address_line_1: 'address_line_1', address_line_2: 'address_line_2',
      building_no: 'address_line_1', area_street_name: 'address_line_2',
      branch_address_line_1: 'address_line_1', branch_address_line_2: 'address_line_2',
      city: 'city', district: 'district', state: 'state', pincode: 'pincode',
      branch_city: 'city', branch_district: 'district', branch_state: 'state', branch_pincode: 'pincode',
    };
    const bankKeys   = ['bank_name','bank_branch','holder_name','account_number','account_type','ifsc_code'];
    const branchKeys = ['branch_name','branch_manager','branch_manager_or_admin','branch_mobile_no','branch_mail_id','branch_image'];

    const addrFields = {}, bankFields = {}, branchFields = {};
    for (const [k, v] of Object.entries(fields)) {
      if (addressMap[k])               addrFields[addressMap[k]] = v;
      else if (bankKeys.includes(k))   bankFields[k] = v;
      else if (branchKeys.includes(k)) branchFields[k === 'branch_manager_or_admin' ? 'branch_manager' : k] = v;
    }

    if (use_same_address_as_company  !== undefined) branchFields.same_as_address      = use_same_address_as_company  ?? false;
    if (use_same_bank_as_company     !== undefined) branchFields.same_as_bank_details = use_same_bank_as_company     ?? false;

    let address_id = current?.address_id ?? null;
    if (use_same_address_as_company) {
      // Point branch to company's address row
      if (current?.company_address_id) { address_id = current.company_address_id; branchFields.address_id = address_id; }
    } else if (Object.keys(addrFields).length > 0) {
      if (address_id && !isAddressShared) {
        // Branch owns its own address row — safe to update in place
        const keys = Object.keys(addrFields), vals = Object.values(addrFields);
        await client.query(
          `UPDATE tbl_address SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}, updated_at=now() WHERE id=$${keys.length+1}`,
          [...vals, address_id]
        );
      } else {
        // No address yet, OR currently sharing company's row — always INSERT a new row for the branch
        const r = await client.query(
          `INSERT INTO tbl_address (zodu_id,address_line_1,address_line_2,city,district,state,pincode)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [zodu_id, addrFields.address_line_1??null, addrFields.address_line_2??null,
           addrFields.city??null, addrFields.district??null, addrFields.state??null, addrFields.pincode??null]
        );
        address_id = r.rows[0].id; branchFields.address_id = address_id;
      }
    }

    let bank_details_id = current?.bank_details_id ?? null;
    if (use_same_bank_as_company) {
      // Point branch to company's bank row
      if (current?.company_bank_details_id) { bank_details_id = current.company_bank_details_id; branchFields.bank_details_id = bank_details_id; }
    } else if (Object.keys(bankFields).length > 0 && bankFields.account_number) {
      if (bank_details_id && !isBankShared) {
        // Branch owns its own bank row — safe to update in place
        const keys = Object.keys(bankFields), vals = Object.values(bankFields);
        await client.query(
          `UPDATE tbl_bank_details SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}, updated_at=now() WHERE id=$${keys.length+1}`,
          [...vals, bank_details_id]
        );
      } else {
        // No bank yet, OR currently sharing company's row — always INSERT a new row for the branch
        const r = await client.query(
          `INSERT INTO tbl_bank_details (zodu_id,bank_name,bank_branch,holder_name,account_number,account_type,ifsc_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [zodu_id, bankFields.bank_name??null, bankFields.bank_branch??null,
           bankFields.holder_name??null, bankFields.account_number,
           bankFields.account_type??null, bankFields.ifsc_code??null]
        );
        bank_details_id = r.rows[0].id; branchFields.bank_details_id = bank_details_id;
      }
    }

    let updated;
    if (Object.keys(branchFields).length > 0) {
      const keys = Object.keys(branchFields), vals = Object.values(branchFields);
      const r = await client.query(
        `UPDATE tbl_branch SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')}, updated_at=now()
         WHERE zodu_id=$${keys.length+1} AND branch_id=$${keys.length+2} RETURNING *`,
        [...vals, zodu_id, branch_id]
      );
      updated = r.rows[0] || null;
    } else {
      const r = await client.query(
        `SELECT * FROM tbl_branch WHERE zodu_id=$1 AND branch_id=$2`, [zodu_id, branch_id]
      );
      updated = r.rows[0] || null;
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

exports.findMaxBranchId = async (zodu_id) => {
  const r = await conn.query('SELECT max(branch_id) FROM tbl_branch WHERE zodu_id=$1', [zodu_id]);
  return r.rows[0];
};

// ── INVOICE SETTINGS ─────────────────────────────────────────────────────────

exports.getInvoiceSettings = async (zodu_id, branch_id) => {
  const r = await conn.query(
    `SELECT * FROM tbl_invoice_settings WHERE zodu_id=$1 AND branch_id=$2`,
    [zodu_id, branch_id]
  );
  return r.rows[0] || null;
};

exports.upsertInvoiceSettings = async (zodu_id, branch_id, fields) => {
  const allowed = [
    'invoice_prefix',
    'default_tax_label', 'invoice_due_days', 'default_payment_method',
    'printer_inch', 'show_company_logo', 'print_thank_you_message',
  ];
  const cols = Object.keys(fields).filter((k) => allowed.includes(k));

  if (cols.length === 0) {
    return exports.getInvoiceSettings(zodu_id, branch_id);
  }

  const insertCols = ['zodu_id', 'branch_id', ...cols];
  const insertVals = [zodu_id, branch_id, ...cols.map((c) => fields[c])];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  const r = await conn.query(
    `INSERT INTO tbl_invoice_settings (${insertCols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (zodu_id, branch_id) DO UPDATE SET ${updateSet}
     RETURNING *`,
    insertVals
  );
  return r.rows[0];
};
