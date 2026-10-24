// FM (Facility Management) MySQL pool — the WRITE side of the daily sync.
//
// The bridge is the Embassy->FM worker: it reads Embassy via db.js (read-only)
// and WRITES the org hierarchy into the FM database through this pool. That
// means the bridge host needs network access to the FM MySQL and FM_DB_*
// credentials in .env. (This is the ETL-worker tradeoff: the bridge now holds
// both databases' creds. Pantry stays read-only over HTTP — only the hierarchy
// sync writes.)

const mysql = require('mysql2/promise');

let pool = null;

function createPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host:     process.env.FM_DB_HOST || '127.0.0.1',
    port:     Number(process.env.FM_DB_PORT || 3306),
    user:     process.env.FM_DB_USER,
    password: process.env.FM_DB_PASSWORD,
    database: process.env.FM_DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.FM_DB_CONNECTION_LIMIT || 4),
    queueLimit: 20,
    connectTimeout: Number(process.env.FM_DB_TIMEOUT_MS || 8000),
    dateStrings: true,
    multipleStatements: false,
  });
  return pool;
}

async function getConnection() {
  return createPool().getConnection();
}

async function query(sql, params = []) {
  const [rows] = await createPool().query(sql, params);
  return rows;
}

async function verifyConnection() {
  try {
    const rows = await query('SELECT 1 AS ok');
    if (rows && rows[0] && rows[0].ok === 1) {
      console.log('[bridge] FM DB reachable ✓');
      return true;
    }
    return false;
  } catch (err) {
    console.error('[bridge] FM DB unreachable:', err && err.code, err && err.message);
    return false;
  }
}

async function end() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getConnection, query, verifyConnection, end };
