const conn = require('../database/connection');


exports.generatePublicOrderNo = async (branch_id) => {
  const tplRes = await conn.query(
    `SELECT numbering_type, reset_policy
     FROM tbl_order_no_template
     WHERE branch_id = $1 AND is_active = true`,
    [branch_id]
  );

  if (!tplRes.rowCount) {
    throw new Error("Order number template not configured");
  }

  const { numbering_type, reset_policy } = tplRes.rows[0];

  let period_key = "GLOBAL";
  const now = new Date();

  if (reset_policy === "DAILY") {
    period_key = now.toISOString().slice(0, 10).replace(/-/g, "");
  } else if (reset_policy === "MONTHLY") {
    period_key = now.toISOString().slice(0, 7).replace("-", "");
  } else if (reset_policy === "YEARLY") {
    period_key = String(now.getFullYear());
  }

  // Use an explicit transaction and an atomic update-or-insert
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE tbl_order_no_counter
       SET last_seq = last_seq + 1
       WHERE branch_id = $1 AND period_key = $2
       RETURNING last_seq`,
      [branch_id, period_key]
    );

    let seq;
    if (updateRes.rowCount) {
      seq = updateRes.rows[0].last_seq;
    } else {
      const insertRes = await client.query(
        `INSERT INTO tbl_order_no_counter (branch_id, period_key, last_seq)
         VALUES ($1, $2, 1)
         RETURNING last_seq`,
        [branch_id, period_key]
      );
      seq = insertRes.rows[0].last_seq;
    }

    await client.query('COMMIT');
    // release and return
    client.release();

    return numbering_type === "BRANCH_SEQ"
      ? `${branch_id}-${seq}`
      : String(seq);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw err;
  }

  return numbering_type === "BRANCH_SEQ"
    ? `${branch_id}-${seq}`
    : String(seq);
};
