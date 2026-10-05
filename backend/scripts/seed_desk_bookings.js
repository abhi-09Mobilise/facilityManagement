// Seed DESK bookings for one tenant so the timeline, reports and dashboard
// have something to show. Desk-only by design: it books 'desk'-type facilities
// that have a saved layout_json, assigns a real chair id to each booking's
// desk_id, and sets attendee_count = 1 (one seat per booking).
//
// It derives every id from the DB (facilities, chairs, users, departments) —
// nothing is hard-coded except the tenant, which defaults to 15 and can be
// overridden with --tenant N.
//
// Spread of data it creates (weekdays only):
//   - past days   -> mostly 'completed' (checked-out), a few 'cancelled'
//   - today       -> 'approved' / 'pending' (so the LIVE dashboard lights up)
//   - future days -> 'approved' / 'pending' (upcoming on the timeline)
//
// Idempotent: every row it writes carries remarks = 'SEED:T<tenant>'. On each
// run it first deletes prior rows with that marker for the tenant, then
// re-inserts — so you can re-run freely without piling up duplicates.
//
// Usage:
//   node backend/scripts/seed_desk_bookings.js                 (tenant 15)
//   node backend/scripts/seed_desk_bookings.js --tenant 15
//   node backend/scripts/seed_desk_bookings.js --tenant 15 --days-past 30 --days-future 14 --fill 0.6
//   node backend/scripts/seed_desk_bookings.js --tenant 15 --dry-run
//
// Flags:
//   --tenant N        tenant id to seed (default 15)
//   --days-past N     weekdays of history to generate (default 21)
//   --days-future N   weekdays ahead to generate (default 10)
//   --fill F          fraction of a facility's desks booked per day, 0..1 (default 0.6)
//   --dry-run         compute + print the plan without writing anything

const { pool, query, execute } = require('../src/db/pool');

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { tenant: 15, daysPast: 21, daysFuture: 10, fill: 0.6, total: null, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--tenant')       out.tenant = parseInt(a[++i], 10);
    else if (k === '--days-past')   out.daysPast = parseInt(a[++i], 10);
    else if (k === '--days-future') out.daysFuture = parseInt(a[++i], 10);
    else if (k === '--fill')        out.fill = parseFloat(a[++i]);
    else if (k === '--total')       out.total = parseInt(a[++i], 10);
    else if (k === '--dry-run')     out.dryRun = true;
    else if (k === '--help' || k === '-h') {
      console.log('Usage: node scripts/seed_desk_bookings.js --tenant 15 [--total 50 | --fill 0.6] [--days-past 21] [--days-future 10] [--dry-run]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.tenant)) throw new Error('--tenant must be a number');
  out.fill = Math.max(0.05, Math.min(1, out.fill));
  return out;
}

// --- tiny helpers -----------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dt(dayStr, h, m) { return `${dayStr} ${pad(h)}:${pad(m)}:00`; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Working-day slots a desk booking can take. One booking per desk per day.
const SLOTS = [
  { kind: 'full', sh: 9,  sm: 0, eh: 18, em: 0, weight: 6 },
  { kind: 'am',   sh: 9,  sm: 0, eh: 13, em: 0, weight: 2 },
  { kind: 'pm',   sh: 13, sm: 0, eh: 18, em: 0, weight: 2 },
];
function pickSlot() {
  const bag = [];
  for (const s of SLOTS) for (let i = 0; i < s.weight; i++) bag.push(s);
  return pick(bag);
}

// Status for a given day offset (negative = past, 0 = today, positive = future).
function pickStatus(offset) {
  const r = Math.random();
  if (offset < 0) return r < 0.85 ? 'completed' : 'cancelled';
  if (offset === 0) return r < 0.7 ? 'approved' : r < 0.9 ? 'pending' : 'completed';
  return r < 0.75 ? 'approved' : 'pending';
}

function chairIdsFromLayout(layoutJson) {
  if (!layoutJson) return [];
  let layout;
  try { layout = typeof layoutJson === 'string' ? JSON.parse(layoutJson) : layoutJson; }
  catch { return []; }
  const objs = (layout && Array.isArray(layout.objects)) ? layout.objects : [];
  // Bookable chairs only — skip VIP seats (never offered to bookers) and
  // anything without a stable id.
  return objs
    .filter((o) => o && o.type === 'chair' && o.id && !o.isVip)
    .map((o) => String(o.id));
}

async function main() {
  const opts = parseArgs();
  const TAG = `SEED:T${opts.tenant}`;
  console.log(`[seed-desk] tenant=${opts.tenant} past=${opts.daysPast}d future=${opts.daysFuture}d fill=${opts.fill}${opts.dryRun ? ' (DRY RUN)' : ''}`);

  // 1) Desk facilities with a saved layout for this tenant.
  const facilities = await query(
    "SELECT id, name, layout_json FROM `facilities` " +
    " WHERE tenant_id = ? AND trash = 0 AND status = 1 " +
    "   AND type = 'desk' AND layout_json IS NOT NULL",
    [opts.tenant]
  );
  const deskFacilities = facilities
    .map((f) => ({ id: f.id, name: f.name, chairs: chairIdsFromLayout(f.layout_json) }))
    .filter((f) => f.chairs.length > 0);

  if (deskFacilities.length === 0) {
    console.error(
      `[seed-desk] No 'desk' facilities with chairs found for tenant ${opts.tenant}. ` +
      `Create a desk facility and design its floor plan (chairs) first.`
    );
    await pool.end();
    process.exit(1);
  }
  console.log(`[seed-desk] desk facilities: ${deskFacilities.length} ` +
    `(${deskFacilities.map((f) => `${f.name}:${f.chairs.length} chairs`).join(', ')})`);

  // 2) Booker pool: active tenant users, prefer ones that have a department so
  //    the per-department reports have something to group by.
  const users = await query(
    "SELECT id, department_id, name, lname FROM `users` " +
    " WHERE tenant_id = ? AND trash = 0 AND status = 1 " +
    "   AND role IN ('employee','approver','org_admin','tenant_admin') " +
    " ORDER BY (department_id IS NULL), id " +
    " LIMIT 400",
    [opts.tenant]
  );
  if (users.length === 0) {
    console.error(`[seed-desk] No active users for tenant ${opts.tenant} — create some employees first.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`[seed-desk] booker pool: ${users.length} users`);

  // 3) Build (facility × weekday) cells across the window, then decide how many
  //    desks to book per cell — either a fixed --total spread evenly across all
  //    cells, or a per-facility --fill fraction.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cells = [];
  for (let off = -opts.daysPast; off <= opts.daysFuture; off++) {
    const d = new Date(today);
    d.setDate(d.getDate() + off);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    const dayStr = ymd(d);
    for (const fac of deskFacilities) cells.push({ off, dayStr, fac });
  }
  if (cells.length === 0) { console.error('[seed-desk] window has no weekdays'); await pool.end(); process.exit(1); }

  // Per-cell desk count.
  if (opts.total != null) {
    // Spread the target total as evenly as possible; shuffle so the leftover
    // (+1) bookings land on random days rather than always the earliest.
    cells = shuffle(cells);
    const base = Math.floor(opts.total / cells.length);
    const rem = opts.total % cells.length;
    cells.forEach((c, i) => { c.take = Math.min(c.fac.chairs.length, base + (i < rem ? 1 : 0)); });
  } else {
    cells.forEach((c) => { c.take = Math.max(1, Math.min(c.fac.chairs.length, Math.round(c.fac.chairs.length * opts.fill))); });
  }

  const rows = [];
  const counts = { completed: 0, cancelled: 0, approved: 0, pending: 0 };
  for (const c of cells) {
    if (!c.take) continue;
    const chosenChairs = shuffle(c.fac.chairs).slice(0, c.take);
    for (const chair of chosenChairs) {
      const u = pick(users);
      const slot = pickSlot();
      const status = pickStatus(c.off);
      counts[status]++;
      rows.push([
        opts.tenant,
        c.fac.id,
        chair,
        u.id,
        u.department_id || null,
        `Desk ${chair}`,
        dt(c.dayStr, slot.sh, slot.sm),
        dt(c.dayStr, slot.eh, slot.em),
        'none',
        status,
        status === 'completed' ? 'approved' : 'not_started', // checkout_status
        TAG,
        0,  // dont_disturb
        1,  // attendee_count (one seat)
      ]);
    }
  }

  console.log(`[seed-desk] planned ${rows.length} bookings — ` +
    `completed=${counts.completed} approved=${counts.approved} pending=${counts.pending} cancelled=${counts.cancelled}`);

  if (opts.dryRun) {
    console.log('[seed-desk] DRY RUN — no rows written. Sample:');
    for (const r of rows.slice(0, 5)) console.log('   ', JSON.stringify(r));
    await pool.end();
    return;
  }

  // 4) Wipe prior seeded rows for this tenant, then bulk-insert.
  const del = await execute('DELETE FROM `bookings` WHERE tenant_id = ? AND remarks = ?', [opts.tenant, TAG]);
  const delCount = (del && del[0] && del[0].affectedRows) || 0;
  if (delCount > 0) console.log(`[seed-desk] removed ${delCount} previously-seeded rows`);

  const cols = '(tenant_id, facility_id, desk_id, user_id, department_id, title, start_at, end_at, ' +
               'repeat_type, status, checkout_status, remarks, dont_disturb, attendee_count)';
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flat = chunk.flat();
    await execute('INSERT INTO `bookings` ' + cols + ' VALUES ' + placeholders, flat);
    inserted += chunk.length;
  }

  console.log(`[seed-desk] DONE — inserted ${inserted} desk bookings for tenant ${opts.tenant}.`);
  console.log('[seed-desk] Timeline + dashboard read bookings live, so they should populate immediately.');
  await pool.end();
}

main().catch((err) => {
  console.error('[seed-desk] fatal:', err && err.stack || err);
  process.exit(1);
});
