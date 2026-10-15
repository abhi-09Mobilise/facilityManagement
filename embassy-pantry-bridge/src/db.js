// Embassy MySQL pool.
//
// Only instantiated when BRIDGE_MODE=live. In mock mode this module's
// `pool` export is null and callers short-circuit before touching it.
//
// The Embassy brief recommended enabling PDO::ATTR_EMULATE_PREPARES in the
// Laravel app to halve round-trips over the high-latency Azure link —
// mysql2's `namedPlaceholders:false` + default behaviour already gives us
// client-side prepared statements, so we just leave both at default.
//
// For Azure MySQL Flexible Server (prod), set EMBASSY_DB_SSL=true. The
// pool loads BaltimoreCyberTrustRoot.crt.pem from this folder (operator
// needs to drop the CA bundle in; Azure's docs show how to grab it).

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

function createPool() {
  if (pool) return pool;

  const ssl = String(process.env.EMBASSY_DB_SSL || 'false').toLowerCase() === 'true';
  const sslOpts = ssl ? loadSslOptions() : undefined;

  pool = mysql.createPool({
    host:     process.env.EMBASSY_DB_HOST,
    port:     Number(process.env.EMBASSY_DB_PORT || 3306),
    user:     process.env.EMBASSY_DB_USER,
    password: process.env.EMBASSY_DB_PASSWORD,
    database: process.env.EMBASSY_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,     // keep small — this is a read-only aggregator
    queueLimit: 20,
    connectTimeout: Number(process.env.EMBASSY_DB_TIMEOUT_MS || 8000),
    ssl: sslOpts,
    // Date columns come back as Date objects by default — keep them as
    // strings so transformers don't have to care about timezone-shifting.
    dateStrings: true,
  });

  return pool;
}

function loadSslOptions() {
  const caPath = path.join(__dirname, '..', 'BaltimoreCyberTrustRoot.crt.pem');
  if (!fs.existsSync(caPath)) {
    console.warn(
      '[bridge] EMBASSY_DB_SSL=true but BaltimoreCyberTrustRoot.crt.pem not found at ' + caPath +
      ' — proceeding without pinned CA (TLS still enforced).'
    );
    return { rejectUnauthorized: true };
  }
  return {
    rejectUnauthorized: true,
    ca: fs.readFileSync(caPath, 'utf8'),
  };
}

// Thin wrapper so callers always use parameterised queries.
async function query(sql, params = []) {
  const p = createPool();
  const [rows] = await p.query(sql, params);
  return rows;
}

async function verifyConnection() {
  try {
    const rows = await query('SELECT 1 AS ok');
    if (rows && rows[0] && rows[0].ok === 1) {
      console.log('[bridge] Embassy DB reachable ✓');
      return true;
    }
    console.warn('[bridge] Embassy DB SELECT 1 returned unexpected row:', rows);
    return false;
  } catch (err) {
    console.error('[bridge] Embassy DB unreachable:', err && err.code, err && err.message);
    return false;
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, verifyConnection, close };
