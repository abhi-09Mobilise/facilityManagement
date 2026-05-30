// Dashboards.
//
// GET /api/dashboards/tenant-admin
//   Single payload powering the tenant admin dashboard:
//     summary       - {total_facilities, occupied_now, free_now}
//     per_facility  - [{ id, name, type, capacity,
//                        today_open_minutes, today_booked_minutes }]
//
// Tenant-scoping:
//   - super_admin can pass ?tenant_id=N to narrow to one tenant. If omitted,
//     the payload aggregates across EVERY tenant (cross-tenant totals).
//   - everyone else is locked to their own tenant_id.

const { query } = require('../../db/pool');
const { ok } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');

function emptyPayload() {
  return {
    summary: { total_facilities: 0, occupied_now: 0, free_now: 0 },
    per_facility: [],
    as_of: new Date().toISOString(),
  };
}

exports.tenantAdmin = asyncHandler(async function (req, res) {
  // Scope filters.
  //   - super_admin: REQUIRES ?tenant_id= now. Returning every tenant's
  //     facilities at once froze the browser on tenants with 1000+ rows;
  //     the frontend always sends a tenant_id once one is picked.
  //   - tenant_admin: pinned to their own tenant. Optional ?site_id= to
  //     narrow further (one site at a time vs every facility everywhere).
  //   - Hard LIMIT on per-facility rows so a misconfigured filter never
  //     pulls 1000+ rows into the payload.
  const FACILITY_LIMIT = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  let tenantClause = '';
  const tenantParams = [];
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) {
      // No tenant picked yet — render the picker without flashing data.
      return ok(res, emptyPayload());
    }
    tenantClause = ' AND f.tenant_id = ? ';
    tenantParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, emptyPayload());
    tenantClause = ' AND f.tenant_id = ? ';
    tenantParams.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    tenantClause += ' AND f.site_id = ? ';
    tenantParams.push(siteId);
  }

  // -- per-facility today_open_minutes from operating hours --
  // MySQL's DAYOFWEEK returns 1..7 (Sun=1); our schema uses 0..6 (Sun=0).
  const openRows = await query(
    'SELECT f.id, f.name, f.type, f.capacity, ' +
    '       COALESCE(SUM(TIMESTAMPDIFF(MINUTE, oh.open_time, oh.close_time)), 0) AS today_open_minutes ' +
    '  FROM `facilities` f ' +
    '  LEFT JOIN `facility_operating_hours` oh ' +
    '    ON oh.facility_id = f.id AND oh.day_of_week = DAYOFWEEK(CURDATE()) - 1 ' +
    ' WHERE f.trash = 0 AND f.status = 1 ' + tenantClause +
    ' GROUP BY f.id, f.name, f.type, f.capacity ' +
    ' ORDER BY f.name ' +
    ' LIMIT ' + FACILITY_LIMIT,
    tenantParams
  );

  if (openRows.length === 0) return ok(res, emptyPayload());

  // Constrain booking subqueries to ONLY the facilities we already
  // selected — keeps joins narrow when the tenant has 1000+ facilities
  // total but we're viewing one site of 30.
  const facIds = openRows.map((r) => r.id);
  const facPlaceholders = facIds.map(() => '?').join(',');

  // -- per-facility today_booked_minutes --
  const bookedRows = await query(
    'SELECT b.facility_id AS id, ' +
    '       COALESCE(SUM(' +
    '         TIMESTAMPDIFF(MINUTE, ' +
    '           GREATEST(b.start_at, CONCAT(CURDATE(), \' 00:00:00\')), ' +
    '           LEAST(b.end_at, CONCAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), \' 00:00:00\')) ' +
    '         )' +
    '       ), 0) AS today_booked_minutes ' +
    '  FROM `bookings` b ' +
    ' WHERE b.facility_id IN (' + facPlaceholders + ') ' +
    "   AND b.trash = 0 " +
    "   AND b.status IN ('approved', 'pending', 'completed') " +
    "   AND b.start_at < CONCAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), ' 00:00:00') " +
    "   AND b.end_at   > CONCAT(CURDATE(), ' 00:00:00') " +
    ' GROUP BY b.facility_id',
    facIds
  );

  // -- which facilities are occupied right now? --
  const occupiedRows = await query(
    'SELECT DISTINCT b.facility_id AS id ' +
    '  FROM `bookings` b ' +
    ' WHERE b.facility_id IN (' + facPlaceholders + ') ' +
    "   AND b.trash = 0 " +
    "   AND b.status IN ('approved', 'pending', 'completed') " +
    '   AND b.start_at <= NOW() AND b.end_at > NOW()',
    facIds
  );

  const bookedByFacility = new Map();
  for (const r of bookedRows) bookedByFacility.set(r.id, Number(r.today_booked_minutes) || 0);

  const occupiedSet = new Set(occupiedRows.map((r) => r.id));

  const perFacility = openRows.map((r) => {
    const open = Math.max(0, Number(r.today_open_minutes) || 0);
    let booked = Math.max(0, bookedByFacility.get(r.id) || 0);
    // Cap booked at open so the pie is never > 100% (a booking that runs
    // outside operating hours would otherwise overshoot).
    if (open > 0) booked = Math.min(booked, open);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      today_open_minutes: open,
      today_booked_minutes: booked,
      occupied_now: occupiedSet.has(r.id),
    };
  });

  return ok(res, {
    summary: {
      total_facilities: openRows.length,
      occupied_now: occupiedSet.size,
      free_now: openRows.length - occupiedSet.size,
    },
    per_facility: perFacility,
    as_of: new Date().toISOString(),
  });
});

// F08 - Gantt: facilities × time, drill-down to a single booking.
//
// GET /api/dashboards/gantt?site_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns:
//   { facilities: [{ id, name }], items: [{ id, facility_id, title, start, end, status, booker_name }] }
//
// `from` defaults to start of today, `to` defaults to from + 1 day. Window
// is capped to 31 days so large tenants don't accidentally pull the whole
// year. Tenant scoping mirrors the rest of /dashboards endpoints.

exports.gantt = asyncHandler(async function (req, res) {
  // F08 - super_admin can either pick a tenant via ?tenant_id= or pull the
  // global cross-tenant view when no tenant_id is passed. Everyone else
  // is pinned to their own tenant.
  let tenantClause = '';
  const tenantParams = [];
  if (req.user.role === 'super_admin') {
    const tid = parseInt(req.query.tenant_id, 10);
    if (tid > 0) {
      tenantClause = ' AND f.tenant_id = ? ';
      tenantParams.push(tid);
    }
  } else {
    if (!req.user.tenant_id) return ok(res, { facilities: [], items: [] });
    tenantClause = ' AND f.tenant_id = ? ';
    tenantParams.push(req.user.tenant_id);
  }

  const siteId = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromStr = String(req.query.from || todayStart.toISOString().slice(0, 10));
  const toStr   = String(req.query.to   || new Date(todayStart.getTime() + 24*60*60*1000).toISOString().slice(0, 10));

  // Cap window
  const from = new Date(fromStr); const to = new Date(toStr);
  if (isNaN(from) || isNaN(to)) return fail(res, 'from / to must be YYYY-MM-DD', 422);
  if ((to - from) / (24*60*60*1000) > 31) {
    return fail(res, 'Window too large - cap is 31 days', 422);
  }

  const fromMysql = fromStr + ' 00:00:00';
  const toMysql   = toStr   + ' 23:59:59';

  // Build the facilities WHERE: tenantClause is already 'AND f.tenant_id...'
  // (or empty for cross-tenant super_admin view); site filter is optional.
  const facExtra = [];
  const facExtraParams = [];
  if (siteId) { facExtra.push(' AND f.site_id = ? '); facExtraParams.push(siteId); }

  // Cross-tenant view labels each facility with its tenant for readability.
  const facilities = await query(
    'SELECT f.id, f.name, f.type, f.tenant_id, t.name AS tenant_name ' +
    '  FROM `facilities` f ' +
    '  LEFT JOIN `tenants` t ON t.id = f.tenant_id ' +
    ' WHERE f.trash = 0 AND f.status = 1 ' + tenantClause + facExtra.join('') +
    ' ORDER BY ' + (tenantClause ? 'f.name' : 't.name, f.name'),
    [...tenantParams, ...facExtraParams]
  );
  if (facilities.length === 0) return ok(res, { facilities: [], items: [] });

  const facIds = facilities.map((f) => f.id);
  const placeholders = facIds.map(() => '?').join(',');
  const items = await query(
    'SELECT b.id, b.facility_id, b.title, b.start_at, b.end_at, b.status, ' +
    '       u.name AS booker_name, u.lname AS booker_lname, u.username AS booker_username ' +
    '  FROM `bookings` b ' +
    '  LEFT JOIN `users` u ON u.id = b.user_id ' +
    ' WHERE b.facility_id IN (' + placeholders + ') AND b.trash = 0 ' +
    "   AND b.status IN ('pending','approved','completed') " +
    '   AND b.start_at < ? AND b.end_at > ? ' +
    ' ORDER BY b.facility_id, b.start_at',
    [...facIds, toMysql, fromMysql]
  );

  return ok(res, {
    facilities,
    items: items.map((i) => ({
      id: i.id,
      facility_id: i.facility_id,
      title: i.title || null,
      start_at: typeof i.start_at === 'string' ? i.start_at : new Date(i.start_at).toISOString().replace('T', ' ').slice(0, 19),
      end_at:   typeof i.end_at   === 'string' ? i.end_at   : new Date(i.end_at  ).toISOString().replace('T', ' ').slice(0, 19),
      status: i.status,
      booker_name: [i.booker_name, i.booker_lname].filter(Boolean).join(' ') || i.booker_username || null,
    })),
  });
});
