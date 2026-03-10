const mysql = require('mysql2/promise');
let pool;

async function initDB() {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit: 15,
    charset: 'utf8mb4',
  });
  const conn = await pool.getConnection();
  console.log('[game-api] MySQL connected');
  conn.release();
}

function getDB() {
  if (!pool) throw new Error('DB not initialized');
  return pool;
}

module.exports = { initDB, getDB };
