// Demo seed - super admin + 5 demo tenants with realistic volumes:
//
//   5 tenants
//   ~7 sites per tenant      (5-10 range)        =>  ~35 sites total
//   ~12 floors per site      (4-20 range)        =>  ~420 floors total
//   ~3 facilities per floor  (1-5 range)         =>  ~1260 facilities total
//   ~8 departments per tenant                    =>  ~40 departments total
//   ~1400 users per tenant                       =>  ~7000 users total
//   + facility operating hours (5 weekdays / facility) ~6300
//   + meal_times (3 per tenant)                  =>  15
//   + ~600 sample bookings spread across tenants
//
// Total inserted rows: ~16k. Idempotent at the tenant-slug level — if a
// tenant with the same slug already exists, that whole tenant block is
// skipped. So you can re-run after a failure without doubling rows.
//
// Run with: npm run seed   (or)   node scripts/seed.js
//
// IMPORTANT — lock behaviour:
//   Each INSERT is issued as its OWN statement with autocommit on (no
//   transaction wrapping a tenant block). That means each row's
//   row-level lock is released the moment the INSERT commits, so the
//   seed does not hold a long-running lock that could block app traffic
//   if you ever ran this against a live DB.
//
//   Cost: ~16k single round-trips instead of a few batched ones. Expect
//   60-120 seconds end-to-end on localhost vs. ~10s for the batched
//   version. Acceptable trade-off given the no-lock requirement.
//
//   bcrypt.hash is still called ONCE for the shared bulk password — the
//   hash is reused for all 7k users. Without that the seed would burn
//   5+ minutes of CPU just hashing.

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const SUPER_USERNAME  = process.env.SUPER_ADMIN_USERNAME  || 'superadmin';
const SUPER_PASSWORD  = process.env.SUPER_ADMIN_PASSWORD  || 'password@1k';
const BULK_PASSWORD   = process.env.BULK_USER_PASSWORD    || 'password@1k';

// Knobs — tweak here to scale the seed up/down without touching code below.
const TENANTS_SPEC = [
  { name: 'Mobilise Demo Campus',  slug: 'demo',     adminEmail: 'admin@demo.local',     userCount: 1400 },
  { name: 'Acme Corporation',      slug: 'acme',     adminEmail: 'admin@acme.local',     userCount: 1400 },
  { name: 'Globex Industries',     slug: 'globex',   adminEmail: 'admin@globex.local',   userCount: 1400 },
  { name: 'Initech Solutions',     slug: 'initech',  adminEmail: 'admin@initech.local',  userCount: 1400 },
  { name: 'Umbrella Holdings',     slug: 'umbrella', adminEmail: 'admin@umbrella.local', userCount: 1400 },
];
const SITES_PER_TENANT_MIN  = 5;
const SITES_PER_TENANT_MAX  = 10;
const FLOORS_PER_SITE_MIN   = 4;
const FLOORS_PER_SITE_MAX   = 20;
const FACILITIES_PER_FLOOR_MIN = 1;
const FACILITIES_PER_FLOOR_MAX = 5;
const DEPTS_PER_TENANT_MIN  = 6;
const DEPTS_PER_TENANT_MAX  = 10;
const SAMPLE_BOOKINGS_PER_TENANT = 100;

const FACILITY_TYPES = [
  'meeting_room', 'conference_room', 'gym', 'desk', 'swimming_pool', 'other',
];

// Seeded random — deterministic so re-runs produce the same dataset.
let _rngState = 0xC0FFEE;
function rand() {
  let x = _rngState | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  _rngState = x;
  return ((x >>> 0) / 0xFFFFFFFF);
}
function randInt(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

// ----------------------------------------------------------------------
// Name pools
// ----------------------------------------------------------------------

const FIRST_NAMES = [
  'Aarav','Aditi','Anika','Arjun','Diya','Ishaan','Kavya','Krishna',
  'Maya','Nikhil','Priya','Rahul','Riya','Rohan','Sara','Vihaan',
  'Aditya','Ananya','Karan','Meera','Neha','Pooja','Ravi','Tanvi',
  'Vivek','Yash','Sneha','Manoj','Lakshmi','Suresh','Kiran','Anjali',
  'Deepak','Geeta','Harsh','Indra','Jyoti','Karthik','Latha','Mohan',
  'Nisha','Omkar','Padma','Qadir','Rashmi','Sanjay','Tara','Uma',
  'Varun','Wasim','Xavier','Yamini','Zara',
];
const LAST_NAMES = [
  'Sharma','Verma','Singh','Kumar','Patel','Gupta','Mehta','Joshi',
  'Iyer','Nair','Reddy','Rao','Pandey','Mishra','Tiwari','Yadav',
  'Khan','Ali','Das','Bose','Chatterjee','Banerjee','Mukherjee',
  'Sengupta','Pillai','Menon','Shah','Desai','Bhat','Kapoor',
];
const DESIGNATIONS = [
  'Engineer','Senior Engineer','Lead Engineer','Manager',
  'HR Executive','Recruiter','Account Manager','Designer',
  'Product Manager','Marketing Lead','Analyst','Director',
  'Sales Executive','Operations','Finance Manager',
];
const DEPARTMENT_BLUEPRINTS = [
  { name: 'Engineering',      code: 'ENG' },
  { name: 'Human Resources',  code: 'HR'  },
  { name: 'Finance',          code: 'FIN' },
  { name: 'Marketing',        code: 'MKT' },
  { name: 'Sales',            code: 'SLS' },
  { name: 'Operations',       code: 'OPS' },
  { name: 'Product',          code: 'PRD' },
  { name: 'Design',           code: 'DES' },
  { name: 'Legal',            code: 'LGL' },
  { name: 'Customer Success', code: 'CS'  },
];
const CITIES = [
  { city: 'Bangalore', code: 'BLR', tz: 'Asia/Kolkata', state: 'KA' },
  { city: 'Mumbai',    code: 'BOM', tz: 'Asia/Kolkata', state: 'MH' },
  { city: 'Delhi',     code: 'DEL', tz: 'Asia/Kolkata', state: 'DL' },
  { city: 'Hyderabad', code: 'HYD', tz: 'Asia/Kolkata', state: 'TG' },
  { city: 'Chennai',   code: 'MAA', tz: 'Asia/Kolkata', state: 'TN' },
  { city: 'Pune',      code: 'PNQ', tz: 'Asia/Kolkata', state: 'MH' },
  { city: 'Kolkata',   code: 'CCU', tz: 'Asia/Kolkata', state: 'WB' },
  { city: 'Ahmedabad', code: 'AMD', tz: 'Asia/Kolkata', state: 'GJ' },
  { city: 'Gurugram',  code: 'GGN', tz: 'Asia/Kolkata', state: 'HR' },
  { city: 'Noida',     code: 'NOI', tz: 'Asia/Kolkata', state: 'UP' },
];

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

async function hash(p) { return bcrypt.hash(p, 10); }

// Look up an existing row, or insert a new one — returns the id either way.
async function upsertById(conn, sql, params, selectSql, selectParams) {
  const [existing] = await conn.execute(selectSql, selectParams);
  if (existing.length > 0) return existing[0].id;
  const [r] = await conn.execute(sql, params);
  return r.insertId;
}

// Single-row insert. Returns the new row's id. ONE statement per row so
// the row-level lock is released the instant the INSERT commits.
async function insertOne(conn, table, cols, values) {
  const colSql = cols.map((c) => '`' + c + '`').join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const [res] = await conn.execute(
    'INSERT INTO `' + table + '` (' + colSql + ') VALUES (' + placeholders + ')',
    values
  );
  return res.insertId;
}

// Convenience — log a one-line progress tick every N rows so the operator
// sees the seed making progress on the long user/operating-hours loops.
function tick(label, done, total) {
  if (done === total || done % 200 === 0) {
    process.stdout.write('\r    ' + label + ' ' + done + '/' + total + '   ');
    if (done === total) process.stdout.write('\n');
  }
}

// Random 10-digit Indian mobile (deterministic via our seeded RNG).
function randomMobile() {
  let m = '9';
  for (let i = 0; i < 9; i++) m += String(Math.floor(rand() * 10));
  return m;
}

// MySQL DATETIME literal (YYYY-MM-DD HH:MM:SS) from a Date.
function mysqlDT(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ----------------------------------------------------------------------
// Per-tenant seeder
// ----------------------------------------------------------------------

async function seedTenant(conn, spec, idx, bulkPwHash) {
  // 1. Tenant row (idempotent on slug). No transaction below — each row
  //    is its own committed INSERT so locks are never held across rows.
  const [existing] = await conn.execute(
    'SELECT id FROM tenants WHERE slug = ? LIMIT 1', [spec.slug]
  );
  if (existing.length > 0) {
    console.log('  [' + spec.slug + '] tenant already exists (id=' + existing[0].id + ') — skipping');
    return existing[0].id;
  }

  const tenantId = await insertOne(
    conn, 'tenants',
    ['name', 'slug', 'contact_email', 'currency_code', 'timezone', 'locale', 'status'],
    [spec.name, spec.slug, spec.adminEmail, 'INR', 'Asia/Kolkata', 'en-IN', 'active']
  );
  console.log('  [' + spec.slug + '] tenant: id=' + tenantId);

  // 2. Sites — 5–10 per tenant.
  const siteCount = randInt(SITES_PER_TENANT_MIN, SITES_PER_TENANT_MAX);
  const siteIds = [];
  for (let i = 0; i < siteCount; i++) {
    const c = CITIES[(idx * 7 + i) % CITIES.length];
    const sid = await insertOne(
      conn, 'sites',
      ['tenant_id', 'name', 'code', 'address', 'timezone'],
      [
        tenantId,
        c.city + ' ' + (i === 0 ? 'HQ' : ('Office ' + (i + 1))),
        c.code + '-' + String(i + 1).padStart(2, '0'),
        'Block ' + (i + 1) + ', ' + c.city + ', ' + c.state,
        c.tz,
      ]
    );
    siteIds.push(sid);
  }
  console.log('  [' + spec.slug + '] sites: ' + siteIds.length);

  // 3. Floors — 4–20 per site.
  const floorIds = [];
  const floorSiteMap = [];
  for (const sId of siteIds) {
    const fCount = randInt(FLOORS_PER_SITE_MIN, FLOORS_PER_SITE_MAX);
    for (let lv = 0; lv < fCount; lv++) {
      const level = lv + 1;
      const fid = await insertOne(
        conn, 'floors',
        ['tenant_id', 'site_id', 'name', 'level_number'],
        [tenantId, sId, 'Block A / Floor ' + level, level]
      );
      floorIds.push(fid);
      floorSiteMap.push(sId);
      tick('floors', floorIds.length, '?');
    }
  }
  console.log('  [' + spec.slug + '] floors: ' + floorIds.length);

  // 4. Facilities — 1–5 per floor.
  const facilityIds = [];
  const facilityRequiresApproval = [];
  for (let fi = 0; fi < floorIds.length; fi++) {
    const flId = floorIds[fi];
    const stId = floorSiteMap[fi];
    const facCount = randInt(FACILITIES_PER_FLOOR_MIN, FACILITIES_PER_FLOOR_MAX);
    for (let k = 0; k < facCount; k++) {
      const type = FACILITY_TYPES[(fi + k) % FACILITY_TYPES.length];
      let capacity;
      switch (type) {
        case 'meeting_room':    capacity = randInt(4, 12);   break;
        case 'conference_room': capacity = randInt(20, 80);  break;
        case 'gym':             capacity = randInt(8, 25);   break;
        case 'desk':            capacity = randInt(10, 40);  break;
        case 'swimming_pool':   capacity = randInt(15, 30);  break;
        default:                capacity = randInt(6, 20);
      }
      const name = (type === 'meeting_room' ? 'Meeting Room ' :
                    type === 'conference_room' ? 'Conference Hall ' :
                    type === 'gym' ? 'Gym ' :
                    type === 'desk' ? 'Hot Desks ' :
                    type === 'swimming_pool' ? 'Pool ' : 'Space ') +
                   String.fromCharCode(65 + k) + '-' + (fi + 1);
      const requiresApproval = (type === 'conference_room' || type === 'swimming_pool') ? 1 : 0;
      const facId = await insertOne(
        conn, 'facilities',
        ['tenant_id', 'site_id', 'floor_id', 'name', 'type', 'capacity', 'description', 'requires_approval'],
        [
          tenantId, stId, flId,
          name, type, capacity,
          type + ' on level ' + (fi % 20 + 1),
          requiresApproval,
        ]
      );
      facilityIds.push(facId);
      facilityRequiresApproval.push(requiresApproval);
      tick('facilities', facilityIds.length, '?');
    }
  }
  console.log('  [' + spec.slug + '] facilities: ' + facilityIds.length);

  // 5. Operating hours — weekdays 09:00–19:00. One INSERT per row.
  let ohCount = 0;
  for (const fid of facilityIds) {
    for (let dow = 1; dow <= 5; dow++) {
      await insertOne(
        conn, 'facility_operating_hours',
        ['facility_id', 'day_of_week', 'open_time', 'close_time', 'slot_minutes'],
        [fid, dow, '09:00:00', '19:00:00', 30]
      );
      ohCount++;
      tick('operating_hours', ohCount, facilityIds.length * 5);
    }
  }
  console.log('  [' + spec.slug + '] operating_hours: ' + ohCount);

  // 6. Departments — 6–10 per tenant, anchored to first site.
  const deptCount = Math.min(
    randInt(DEPTS_PER_TENANT_MIN, DEPTS_PER_TENANT_MAX),
    DEPARTMENT_BLUEPRINTS.length
  );
  const deptIds = [];
  for (let di = 0; di < deptCount; di++) {
    const d = DEPARTMENT_BLUEPRINTS[di];
    const did = await insertOne(
      conn, 'departments',
      ['tenant_id', 'site_id', 'name', 'code', 'parent_dept_id', 'manager_user_id'],
      [tenantId, siteIds[0], d.name, d.code, null, null]
    );
    deptIds.push(did);
  }
  console.log('  [' + spec.slug + '] departments: ' + deptIds.length);

  // 7. Tenant admin user — known login.
  const tAdminUsername = spec.slug + 'admin';
  const tAdminEmail = 'admin@' + spec.slug + '.local';
  const tenantAdminId = await insertOne(
    conn, 'users',
    ['tenant_id', 'department_id', 'site_id', 'username', 'password',
     'name', 'lname', 'email', 'designation',
     'role', 'status', 'is_approved'],
    [tenantId, deptIds[0], siteIds[0], tAdminUsername, bulkPwHash,
     'Tenant', 'Admin', tAdminEmail, 'Tenant Admin',
     'tenant_admin', 1, 1]
  );

  // 8. Bulk users — one INSERT each. Slowest section of the seed; logs
  //    every 200 to show progress.
  const userIds = [];
  const userIsApprover = [];   // parallel array — used later for facility approver assignment
  let nameCursor = 0;
  for (let u = 0; u < spec.userCount; u++) {
    const fn = FIRST_NAMES[(nameCursor++) % FIRST_NAMES.length];
    const ln = LAST_NAMES[(u * 7) % LAST_NAMES.length];
    const username = spec.slug + 'u' + String(u + 1).padStart(5, '0');
    const email = (fn + '.' + ln + (u + 1) + '@' + spec.slug + '.local').toLowerCase();
    const designation = DESIGNATIONS[(u * 3) % DESIGNATIONS.length];
    const role = (u % 50 === 0) ? 'approver' : 'employee';
    const isApprover = (role === 'approver') ? 1 : 0;
    const siteId = siteIds[u % siteIds.length];
    const deptId = deptIds[u % deptIds.length];
    const uid = await insertOne(
      conn, 'users',
      ['tenant_id', 'department_id', 'site_id', 'username', 'password',
       'name', 'lname', 'email', 'mobile',
       'designation', 'role', 'status', 'is_approved', 'is_approver'],
      [tenantId, deptId, siteId, username, bulkPwHash,
       fn, ln, email, randomMobile(),
       designation, role, 1, 1, isApprover]
    );
    userIds.push(uid);
    userIsApprover.push(isApprover === 1);
    tick('users', u + 1, spec.userCount);
  }
  console.log('  [' + spec.slug + '] users: ' + (userIds.length + 1) + ' (incl. tenant admin)');

  // 9. Backfill department managers — first user in each dept becomes
  //    the manager and gets designation='Manager'.
  for (let di = 0; di < deptIds.length; di++) {
    const candidate = userIds[di];
    if (!candidate) continue;
    await conn.execute(
      'UPDATE users SET designation = \'Manager\' WHERE id = ?',
      [candidate]
    );
    await conn.execute(
      'UPDATE departments SET manager_user_id = ? WHERE id = ?',
      [candidate, deptIds[di]]
    );
  }

  // 10. Facility approver pointer — pick from the approver pool.
  const approverPool = userIds.filter((_, i) => userIsApprover[i]);
  if (approverPool.length > 0) {
    for (let fi = 0; fi < facilityIds.length; fi++) {
      if (facilityRequiresApproval[fi] === 1) {
        const aid = approverPool[fi % approverPool.length];
        await conn.execute(
          'UPDATE facilities SET facility_approver_user_id = ? WHERE id = ?',
          [aid, facilityIds[fi]]
        );
      }
    }
  }

  // 11. Meal times — 3 per tenant.
  for (const [name, start, end] of [
    ['Morning Tea', '09:30:00', '10:00:00'],
    ['Lunch',       '13:00:00', '14:00:00'],
    ['Evening Tea', '16:30:00', '17:00:00'],
  ]) {
    await insertOne(
      conn, 'meal_times',
      ['tenant_id', 'name', 'start_time', 'end_time'],
      [tenantId, name, start, end]
    );
  }

  // 12. Sample bookings — spread across ±14 days, random facility + user.
  const now = new Date();
  for (let b = 0; b < SAMPLE_BOOKINGS_PER_TENANT; b++) {
    const fid = pick(facilityIds);
    const uid = pick(userIds);
    const dayOffset = randInt(-7, 14);
    const hour = randInt(9, 17);
    const start = new Date(now);
    start.setDate(start.getDate() + dayOffset);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + randInt(1, 2));
    const rDie = rand();
    const status = rDie < 0.7 ? 'approved' : rDie < 0.9 ? 'pending' : 'completed';
    await insertOne(
      conn, 'bookings',
      ['tenant_id', 'facility_id', 'user_id', 'department_id',
       'title', 'start_at', 'end_at', 'status', 'attendee_count', 'dont_disturb'],
      [tenantId, fid, uid, deptIds[b % deptIds.length],
       'Sample booking #' + (b + 1),
       mysqlDT(start), mysqlDT(end),
       status, randInt(1, 6), 0]
    );
    tick('bookings', b + 1, SAMPLE_BOOKINGS_PER_TENANT);
  }
  console.log('  [' + spec.slug + '] bookings: ' + SAMPLE_BOOKINGS_PER_TENANT);

  return tenantId;
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

async function main() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false,
  });

  console.log('Seeding ' + config.db.host + ':' + config.db.port + '/' + config.db.database);
  console.log('(individual single-row inserts — no transactions held across rows)');

  // 1. Super admin (idempotent).
  const superHash = await hash(SUPER_PASSWORD);
  const superId = await upsertById(
    conn,
    'INSERT INTO users (tenant_id, username, password, name, lname, email, role, status, is_approved) ' +
    'VALUES (NULL, ?, ?, \'Super\', \'Admin\', \'admin@super.com\', \'super_admin\', 1, 1)',
    [SUPER_USERNAME, superHash],
    'SELECT id FROM users WHERE username = ? LIMIT 1',
    [SUPER_USERNAME]
  );
  console.log('  super admin: id=' + superId + '  ' + SUPER_USERNAME + ' / ' + SUPER_PASSWORD);

  // 2. Hash the shared bulk password ONCE. Same hash reused 7k+ times —
  //    fine for a demo dataset, saves 5+ minutes of CPU.
  const bulkPwHash = await hash(BULK_PASSWORD);
  console.log('  bulk password hash ready (single bcrypt run, reused ' +
              TENANTS_SPEC.reduce((s, t) => s + t.userCount, 0) + 'x)');

  // 3. Per-tenant seed.
  for (let i = 0; i < TENANTS_SPEC.length; i++) {
    await seedTenant(conn, TENANTS_SPEC[i], i, bulkPwHash);
  }

  await conn.end();
  console.log('\nSeed complete.');
  console.log('Super admin   → ' + SUPER_USERNAME + ' / ' + SUPER_PASSWORD);
  console.log('Tenant admins → <slug>admin / ' + BULK_PASSWORD +
              '  (e.g. demoadmin, acmeadmin, globexadmin, initechadmin, umbrelladmin)');
  console.log('Bulk users    → <slug>uNNNNN / ' + BULK_PASSWORD +
              '  (e.g. demou00001, acmeu00500)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
