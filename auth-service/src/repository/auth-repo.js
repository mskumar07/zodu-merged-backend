const conn = require('../database/connection');

// ========== Customer Repository Functions ==========

async function getNextZoduId() {
  const res = await conn.query("SELECT nextval('zodu_seq') as v");
  const n = parseInt(res.rows[0].v, 10);
  return 'ZODU' + String(n).padStart(3, '0');
}

// Find by Email
async function findEmailExist({ email }) {
  return await conn.query(
    'SELECT * FROM tbl_account_creation WHERE email = $1',[email]);
}

async function findPhnExist({ phone_number }) {
  return await conn.query(
    'SELECT * FROM tbl_account_creation WHERE phone_number = $1',[phone_number]);
}




// Create Accound
async function AccountCreationQuery({ zodu_id, restaurant_name, phone_number, email, password_hash }) {
  await conn.query('BEGIN');
  const InsertQuery = await conn.query( 
    `INSERT INTO tbl_account_creation (zodu_id, restaurant_name, phone_number, email, password_hash)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [zodu_id, restaurant_name, phone_number, email, password_hash]);

  if (InsertQuery) {
    await conn.query('COMMIT');       
    return InsertQuery.rows[0];
  }
  conn.query('ROLLBACK'); 
  throw new Error('Unable to create account');
}


// Export functions
module.exports = {
  AccountCreationQuery,
  findEmailExist,
  findPhnExist,
  getNextZoduId
};
