// Demo seed - super admin + demo tenant + tenant admin (also an approver)
// + employees + sites/floors/facilities/meal-times/departments/workflow.
//
// Run with: npm run seed
// Idempotent: safe to re-run; existing rows are detected by unique keys.

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const SUPER_USERNAME  = process.env.SUPER_ADMIN_USERNAME  || 'superadmin';
const SUPER_PASSWORD  = process.env.SUPER_ADMIN_PASSWORD  || 'super123';
const TENANT_USERNAME = process.env.TENANT_ADMIN_USERNAME || 'tenantadmin';
const TENANT_PASSWORD = process.env.TENANT_ADMIN_PASSWORD || 'tenant123';

async function hash(p) { return bcrypt.hash(p, 10); }

async function upsertById(conn, sql, params, selectSql, selectParams) {
  const [existing] = await conn.execute(selectSql, selectParams);
  if (existing.length > 0) return existing[0].id;
  const [r] = await conn.execute(sql, params);
  return r.insertId;
}

async function main() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
  });

  console.log(`Seeding ${config.db.host}:${config.db.port}/${config.db.database}`);

  // 1. Super admin
  const superHash = await hash(SUPER_PASSWORD);
  const superId = await upsertById(
    conn,
    `INSERT INTO users (tenant_id, username, password, name, lname, email, role, status, is_approved)
     VALUES (NULL, ?, ?, 'Super', 'Admin', 'super@platform.local', 'super_admin', 1, 1)`,
    [SUPER_USERNAME, superHash],
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [SUPER_USERNAME]
  );
  console.log(`  super admin: id=${superId}  ${SUPER_USERNAME} / ${SUPER_PASSWORD}`);

  // 2. Demo tenant
  const tenantId = await upsertById(
    conn,
    `INSERT INTO tenants (name, slug, contact_email, currency_code, timezone, locale, status)
     VALUES ('Mobilise Demo Campus', 'demo', 'admin@demo.local', 'INR', 'Asia/Kolkata', 'en-IN', 'active')`,
    [],
    `SELECT id FROM tenants WHERE slug = ? LIMIT 1`,
    ['demo']
  );
  console.log(`  tenant: id=${tenantId}  slug=demo`);

  // 3. Tenant admin (also an approver) + two employees
  const tenantHash = await hash(TENANT_PASSWORD);
  const tenantAdminId = await upsertById(
    conn,
    `INSERT INTO users (tenant_id, username, password, name, lname, email, designation, role, status, is_approved, is_approver)
     VALUES (?, ?, ?, 'Demo', 'Admin', 'admin@demo.local', 'Tenant Admin', 'tenant_admin', 1, 1, 1)`,
    [tenantId, TENANT_USERNAME, tenantHash],
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [TENANT_USERNAME]
  );
  // Idempotent: make sure existing rows after migration get the new flags.
  await conn.execute(
    `UPDATE users SET is_approver = 1, designation = COALESCE(designation, 'Tenant Admin') WHERE id = ?`,
    [tenantAdminId]
  );

  const emp1Hash = await hash('emp123');
  const emp1Id = await upsertById(
    conn,
    `INSERT INTO users (tenant_id, username, password, name, lname, email, designation, role, status, is_approved)
     VALUES (?, 'emp1', ?, 'Ritesh', 'Aggarwal', 'ritesh@demo.local', 'Engineer', 'employee', 1, 1)`,
    [tenantId, emp1Hash],
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    ['emp1']
  );

  const emp2Hash = await hash('emp123');
  const emp2Id = await upsertById(
    conn,
    `INSERT INTO users (tenant_id, username, password, name, lname, email, designation, role, status, is_approved)
     VALUES (?, 'emp2', ?, 'Priya', 'Sharma', 'priya@demo.local', 'HR Executive', 'employee', 1, 1)`,
    [tenantId, emp2Hash],
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    ['emp2']
  );

  console.log(`  tenant admin: id=${tenantAdminId}  ${TENANT_USERNAME} / ${TENANT_PASSWORD}`);
  console.log(`  employees: emp1=${emp1Id}  emp2=${emp2Id}  (password emp123)`);

  // 4. Departments
  const engDeptId = await upsertById(
    conn,
    `INSERT INTO departments (tenant_id, name, code, manager_user_id) VALUES (?, 'Engineering', 'ENG', ?)`,
    [tenantId, tenantAdminId],
    `SELECT id FROM departments WHERE tenant_id = ? AND code = ? LIMIT 1`,
    [tenantId, 'ENG']
  );
  const hrDeptId = await upsertById(
    conn,
    `INSERT INTO departments (tenant_id, name, code, manager_user_id) VALUES (?, 'Human Resources', 'HR', ?)`,
    [tenantId, tenantAdminId],
    `SELECT id FROM departments WHERE tenant_id = ? AND code = ? LIMIT 1`,
    [tenantId, 'HR']
  );
  await conn.execute('UPDATE users SET department_id = ? WHERE id = ?', [engDeptId, emp1Id]);
  await conn.execute('UPDATE users SET department_id = ? WHERE id = ?', [hrDeptId,  emp2Id]);

  // 5. Site + floor
  const siteId = await upsertById(
    conn,
    `INSERT INTO sites (tenant_id, name, code, address, timezone)
     VALUES (?, 'Bangalore HQ', 'BLR-HQ', 'Whitefield, Bangalore, KA', 'Asia/Kolkata')`,
    [tenantId],
    `SELECT id FROM sites WHERE tenant_id = ? AND code = ? LIMIT 1`,
    [tenantId, 'BLR-HQ']
  );
  const floorId = await upsertById(
    conn,
    `INSERT INTO floors (tenant_id, site_id, name, level_number) VALUES (?, ?, 'Block A / Floor 3', 3)`,
    [tenantId, siteId],
    `SELECT id FROM floors WHERE tenant_id = ? AND site_id = ? AND level_number = ? LIMIT 1`,
    [tenantId, siteId, 3]
  );

  // 6. Facilities + operating hours
  const facilitiesSeed = [
    { name: 'Meeting Room A', type: 'meeting_room',    capacity: 8,  desc: 'TV, whiteboard, conf phone' },
    { name: 'Meeting Room B', type: 'meeting_room',    capacity: 4,  desc: 'Small huddle room' },
    { name: 'Gym One',        type: 'gym',             capacity: 12, desc: 'Cardio + free weights' },
    { name: 'Conference Hall',type: 'conference_room', capacity: 40, desc: 'Projector, mic system' },
  ];
  for (const f of facilitiesSeed) {
    const fid = await upsertById(
      conn,
      `INSERT INTO facilities (tenant_id, site_id, floor_id, name, type, capacity, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, siteId, floorId, f.name, f.type, f.capacity, f.desc],
      `SELECT id FROM facilities WHERE tenant_id = ? AND name = ? LIMIT 1`,
      [tenantId, f.name]
    );
    for (let dow = 1; dow <= 5; dow++) {
      await conn.execute(
        `INSERT IGNORE INTO facility_operating_hours (facility_id, day_of_week, open_time, close_time, slot_minutes)
         VALUES (?, ?, '09:00:00', '19:00:00', 30)`,
        [fid, dow]
      );
    }
  }

  // 7. Meal times
  const mealsSeed = [
    { name: 'Morning Tea', start: '09:30:00', end: '10:00:00' },
    { name: 'Lunch',       start: '13:00:00', end: '14:00:00' },
    { name: 'Evening Tea', start: '16:30:00', end: '17:00:00' },
  ];
  for (const m of mealsSeed) {
    await conn.execute(
      `INSERT IGNORE INTO meal_times (tenant_id, name, start_time, end_time) VALUES (?, ?, ?, ?)`,
      [tenantId, m.name, m.start, m.end]
    );
  }

  // 8. Approval workflow - one step routed to the tenant admin (the only seeded approver).
  const wfId = await upsertById(
    conn,
    `INSERT INTO approval_workflows (tenant_id, name, facility_type)
     VALUES (?, 'Conference Room — Tenant Admin Approval', 'conference_room')`,
    [tenantId],
    `SELECT id FROM approval_workflows WHERE tenant_id = ? AND name = ? LIMIT 1`,
    [tenantId, 'Conference Room — Tenant Admin Approval']
  );
  const [existingSteps] = await conn.execute(
    'SELECT id FROM approval_workflow_steps WHERE workflow_id = ?',
    [wfId]
  );
  if (existingSteps.length === 0) {
    await conn.execute(
      `INSERT INTO approval_workflow_steps (workflow_id, step_order, approver_user_id)
       VALUES (?, 1, ?)`,
      [wfId, tenantAdminId]
    );
  }
  await conn.execute(
    `UPDATE facilities SET requires_approval = 1 WHERE tenant_id = ? AND type = 'conference_room'`,
    [tenantId]
  );

  await conn.end();
  console.log('\nSeed complete.');
  console.log('Login as super admin →', SUPER_USERNAME, '/', SUPER_PASSWORD);
  console.log('Login as tenant admin →', TENANT_USERNAME, '/', TENANT_PASSWORD);
  console.log('Login as employee →    emp1 / emp123  (or emp2 / emp123)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
