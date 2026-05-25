// Run pending SQL files from scripts/migrations in filename order.
// Applied filenames are tracked in `schema_migrations` so each file runs once.
//
//   npm run migrate          → apply all pending
//   npm run migrate -- --list → list pending without applying

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTrackingTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`filename\` VARCHAR(255) NOT NULL,
      \`checksum\` CHAR(64) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`filename\`)
    ) ENGINE=InnoDB
  `);
}

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { filename, sql, checksum };
    });
}

async function main() {
  const listOnly = process.argv.includes('--list');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  console.log(`Connected to ${config.db.host}:${config.db.port}/${config.db.database}`);

  await ensureTrackingTable(conn);

  const [appliedRows] = await conn.query('SELECT filename, checksum FROM `schema_migrations`');
  const applied = new Map(appliedRows.map((r) => [r.filename, r.checksum]));

  const migrations = readMigrations();
  if (migrations.length === 0) {
    console.log('No migration files found in scripts/migrations.');
    await conn.end();
    return;
  }

  const pending = migrations.filter((m) => !applied.has(m.filename));

  for (const m of migrations) {
    const prior = applied.get(m.filename);
    if (prior && prior !== m.checksum) {
      console.warn(`! ${m.filename} was modified after being applied (checksum mismatch)`);
    }
  }

  if (listOnly) {
    console.log(`Pending (${pending.length}):`);
    for (const m of pending) console.log(`  - ${m.filename}`);
    await conn.end();
    return;
  }

  if (pending.length === 0) {
    console.log('All migrations already applied.');
    await conn.end();
    return;
  }

  for (const m of pending) {
    console.log(`> applying ${m.filename}`);
    await conn.query(m.sql);
    await conn.execute(
      'INSERT INTO `schema_migrations` (filename, checksum) VALUES (?, ?)',
      [m.filename, m.checksum]
    );
  }

  console.log(`Applied ${pending.length} migration(s).`);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
