const { Pool } = require("pg");
require("dotenv").config(); // load your .env

const pool = new Pool({
  user: String(process.env.DB_USERNAME),
  host: process.env.DB_HOSTNAME,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: Number(process.env.DB_PORT) || 5432
});

(async () => {
  try {
    const res = await pool.query("SELECT * FROM tbl_orders LIMIT 5;");
    console.log("Connected successfully. Rows:", res.rows);
  } catch (err) {
    console.error("DB connection error:", err.message);
  } finally {
    await pool.end();
  }
})();
