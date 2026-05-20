"use strict";

const mysql = require("mysql2/promise");
const cfg = require("./config");

const pool = mysql.createPool({
  host: cfg.db.host,
  port: cfg.db.port,
  database: cfg.db.database,
  user: cfg.db.user,
  password: cfg.db.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

/** Quick connectivity check — throws on failure. */
async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, ping };
