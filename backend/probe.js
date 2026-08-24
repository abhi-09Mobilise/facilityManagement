// Temporary diagnostic — checks that the DB the backend's config resolves to
// actually has `sites.organisation_id`. Run with:
//   node probe.js
// Safe to delete afterwards.

const c = require('./src/config');
const m = require('mysql2/promise');

(async () => {
  const conn = await m.createConnection({
    host: c.db.host,
    port: c.db.port,
    user: c.db.user,
    password: c.db.password,
    database: c.db.database,
  });

  const [srv] = await conn.query(
    "SELECT DATABASE() AS db, @@hostname AS host, @@port AS port"
  );
  console.log('server sees:', srv);

  const [cols] = await conn.query(
    "SHOW COLUMNS FROM sites LIKE 'organisation_id'"
  );
  console.log('col rows via backend config:', cols.length);

  await conn.end();
})().catch((err) => {
  console.error('probe failed:', err && err.message);
  process.exit(1);
});
