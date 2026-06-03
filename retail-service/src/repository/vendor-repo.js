const conn = require("../database/connection");

// 🔹 Generate Next Vendor ID (branch-based)
const getNextVendorId = async (client, zodu_id, branch_id) => {
  const { rows } = await client.query(
    `SELECT vendor_id
     FROM tbl_vendor
     WHERE zodu_id = $1 AND branch_id = $2
     ORDER BY COALESCE(NULLIF(split_part(vendor_id, '-', 2), ''), '0')::int DESC
     LIMIT 1
     FOR UPDATE`,
    [zodu_id, branch_id]
  );

  if (rows.length === 0) return `${branch_id}-1`;

  const lastSeq = parseInt(rows[0].vendor_id.split("-")[1]);
  return `V-${lastSeq + 1}`;
};

// 🔹 CREATE Vendor
exports.createVendor = async (data) => {
  const client = await conn.connect();
  console.log(data)
  try {
    await client.query("BEGIN");

    if (!data?.zodu_id || !data?.branch_id || !data?.vendor_name) {
      throw new Error("zodu_id, branch_id and vendor_name are required");
    }

    const vendor_id = await getNextVendorId(
      client,
      data.zodu_id,
      data.branch_id
    );

    const vendor_type = data.type !== undefined && data.type !== null ? data.type : "Purchase";

    const { rows } = await client.query(
      `INSERT INTO tbl_vendor (
        vendor_id, zodu_id, branch_id,
        vendor_name, company_name, gst,
        vendor_phone, vendor_email,
        vendor_address_1, vendor_address_2,
        city, state, pincode,vendor_type
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        vendor_id,
        data.zodu_id,
        data.branch_id,
        data.vendor_name,
        data.company_name || null,
        data.gst || null,
        data.vendor_phone || null,
        data.vendor_email || null,
        data.vendor_address_1 || null,
        data.vendor_address_2 || null,
        data.city || null,
        data.state || null,
        data.pincode || null,
        vendor_type,
      ]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 🔹 GET Vendors (with filter)
exports.getVendors = async ({ zodu_id, branch_id, search, type }) => {
  const vendorType = type !== undefined && type !== null ? type : "Purchase";
  let query = `SELECT * FROM tbl_vendor WHERE zodu_id=$1 AND branch_id=$2 And vendor_type=$3`;
  const values = [zodu_id, branch_id, vendorType];
  let idx = 4;

  if (search) {
    query += ` AND (vendor_name ILIKE $${idx} OR company_name ILIKE $${idx})`;
    values.push(`%${search}%`);
    idx++;
  }
  

  query += ` ORDER BY vendor_id ASC`;

  const { rows } = await conn.query(query, values);
  return rows;
};

// 🔹 UPDATE Vendor
exports.updateVendor = async (vendor_id, data) => {
  const { rows } = await conn.query(
    `UPDATE tbl_vendor SET
      vendor_name=$1,
      company_name=$2,
      gst=$3,
      vendor_phone=$4,
      vendor_email=$5,
      vendor_address_1=$6,
      vendor_address_2=$7,
      city=$8,
      state=$9,
      pincode=$10,
      vendor_type=$11
     WHERE vendor_id=$12
     RETURNING *`,
    [
      data.vendor_name,
      data.company_name || null,
      data.gst || null,
      data.vendor_phone || null,
      data.vendor_email || null,
      data.vendor_address_1 || null,
      data.vendor_address_2 || null,
      data.city || null,
      data.state || null,
      data.pincode || null,
      data.vendor_type || null,
      vendor_id,
    ]
  );

  if (rows.length === 0) throw new Error("Vendor not found");
  return rows[0];
};

// 🔹 DELETE Vendor (Soft delete recommended)
exports.deleteVendor = async (vendor_id) => {
  const { rows } = await conn.query(
    `DELETE FROM tbl_vendor WHERE vendor_id=$1 RETURNING *`,
    [vendor_id]
  );

  if (rows.length === 0) throw new Error("Vendor not found");
  return rows[0];
};
