const { Pool } = require('pg');
const { DB_USERNAME,DB_PASSWORD,DB_PORT,DB_HOSTNAME,DB_NAME } = require('../config');


// Create a new client instance
const conn = new Pool({
  user: DB_USERNAME,      
  host: DB_HOSTNAME,           
  database: DB_NAME,   
  password: DB_PASSWORD,       
  port: DB_PORT,                 
});

module.exports = conn ;
