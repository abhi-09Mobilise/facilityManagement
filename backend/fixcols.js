// Temporary repair — forces the organisation_id column onto sites /
// departments / users on the DB the backend's config resolves to, and
// backfills sites.organisation_id from each tenant's Default org.
//
// Idempotent: any ALTER that says "Duplicate column name" is fine, means
// the column is already there.
//
// Run with:
//   node fixcols.js
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

  console.log('connected to', c.db.host + ':' + c.db.port + '/' + c.db.database);

  async function tryRun(label, sql) {
    try {
      await conn.query(sql);
      console.log(label + ': added');
    } catch (e) {
      console.log(label + ': ' + (e && e.message));
    }
  }

  await tryRun(
    'sites.organisation_id',
    'ALTER TABLE `sites` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`'
  );
  await tryRun(
    'sites index',
    'CREATE INDEX `idx_sites_org` ON `sites`(`organisation_id`)'
  );

  await tryRun(
    'departments.organisation_id',
    'ALTER TABLE `departments` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`'
  );
  await tryRun(
    'departments index',
    'CREATE INDEX `idx_depts_org` ON `departments`(`organisation_id`)'
  );

  await tryRun(
    'users.organisation_id',
    'ALTER TABLE `users` ADD COLUMN `organisation_id` BIGINT UNSIGNED NULL AFTER `tenant_id`'
  );
  await tryRun(
    'users index',
    'CREATE INDEX `idx_users_org` ON `users`(`organisation_id`)'
  );

  // Backfill sites -> Default org per tenant.
  await conn.query(
    "UPDATE sites s SET s.organisation_id = " +
    "(SELECT o.id FROM organisations o " +
    "  WHERE o.tenant_id = s.tenant_id AND o.slug = 'default' AND o.trash = 0 LIMIT 1) " +
    "WHERE s.organisation_id IS NULL"
  );
  console.log('sites backfilled');

  await conn.query(
    "UPDATE departments d SET d.organisation_id = " +
    "(SELECT o.id FROM organisations o " +
    "  WHERE o.tenant_id = d.tenant_id AND o.slug = 'default' AND o.trash = 0 LIMIT 1) " +
    "WHERE d.organisation_id IS NULL"
  );
  console.log('departments backfilled');

  await conn.query(
    "UPDATE users u SET u.organisation_id = " +
    "(SELECT o.id FROM organisations o " +
    "  WHERE o.tenant_id = u.tenant_id AND o.slug = 'default' AND o.trash = 0 LIMIT 1) " +
    "WHERE u.organisation_id IS NULL AND u.tenant_id IS NOT NULL"
  );
  console.log('users backfilled');

  await conn.end();
})().catch((err) => {
  console.error('fix failed:', err && err.message);
  process.exit(1);
});
