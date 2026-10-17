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
const config = require('../../config');
const pantryBridge = require('../../utils/pantryBridge');

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

  // Organisation scope. The navbar picker sends ?organisation_id= from
  // TenantScopeContext, so all admin roles honour it when present.
  // Facilities don't have an organisation_id column of their own —
  // resolve it via the parent site.
  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    tenantClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    tenantParams.push(orgId);
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

  // Total count ignores FACILITY_LIMIT so the KPI tile shows the real
  // tenant total even when the per-facility list is capped for chart
  // performance. `occupied_now` runs cross-tenant across ALL facilities
  // in scope (not just the capped list) for the same reason.
  const totalCountRow = await query(
    'SELECT COUNT(*) AS n FROM `facilities` f ' +
    ' WHERE f.trash = 0 AND f.status = 1 ' + tenantClause,
    tenantParams
  );
  const totalFacilities = Number((totalCountRow[0] || {}).n || 0);

  const occupiedCountRow = await query(
    'SELECT COUNT(DISTINCT b.facility_id) AS n ' +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    " WHERE b.trash = 0 AND b.status IN ('approved', 'pending', 'completed') " +
    '   AND b.start_at <= NOW() AND b.end_at > NOW() ' +
    '   AND f.trash = 0 AND f.status = 1 ' + tenantClause,
    tenantParams
  );
  const occupiedNow = Number((occupiedCountRow[0] || {}).n || 0);

  return ok(res, {
    summary: {
      total_facilities: totalFacilities,
      occupied_now: occupiedNow,
      free_now: Math.max(0, totalFacilities - occupiedNow),
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
  // (or empty for cross-tenant super_admin view); site + org filters optional.
  const facExtra = [];
  const facExtraParams = [];
  if (siteId) { facExtra.push(' AND f.site_id = ? '); facExtraParams.push(siteId); }
  // Organisation scope from the navbar picker. Facilities don't have their
  // own organisation_id — resolve it via the parent site.
  const ganttOrgId = intOrNull(req.query.organisation_id);
  if (ganttOrgId !== null) {
    facExtra.push(' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ');
    facExtraParams.push(ganttOrgId);
  }

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

// GET /api/dashboards/peak-times
//
// Weekday × hour heatmap feeding the SpaceDesk "Peak booking times" widget.
// Aggregates non-cancelled bookings over a time window and buckets them by
// weekday abbreviation ('Mon'..'Sun') and hour-of-day (0..23). Also returns
// the pre-computed "busiest slot / busiest hour / quietest working hour"
// summary labels so the frontend can render them without extra math.
//
// Query params (all optional):
//   tenant_id?        - super_admin only; required for them, ignored otherwise
//   organisation_id?  - scopes via sites.organisation_id
//   site_id?          - direct facility.site_id filter
//   facility_type?    - e.g. 'Meeting Room' to filter one type
//   from?             - YYYY-MM-DD inclusive; default = 30 days before `to`
//   to?               - YYYY-MM-DD inclusive; default = today
//
// Status filter: only 'pending', 'approved', 'completed' bookings are
// counted. 'cancelled', 'rejected' and 'released' slots are not "activity"
// the heatmap should reflect.
exports.peakTimes = asyncHandler(async function (req, res) {
  // --- Tenant / org / site / type scoping (same pattern as tenantAdmin) ---
  let scopeClause = '';
  const scopeParams = [];
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return ok(res, emptyHeatmap());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, emptyHeatmap());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    scopeClause += ' AND f.site_id = ? ';
    scopeParams.push(siteId);
  }

  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    scopeClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    scopeParams.push(orgId);
  }

  const facilityType = typeof req.query.facility_type === 'string'
    ? req.query.facility_type.trim()
    : '';
  if (facilityType) {
    scopeClause += ' AND f.type = ? ';
    scopeParams.push(facilityType);
  }

  // --- Time window (defaults: last 30 days inclusive of today) ---
  const to = parseIsoDate(req.query.to) || todayIso();
  const from = parseIsoDate(req.query.from) || isoDaysAgo(to, 30);

  // --- Aggregation ---
  // DATE_FORMAT(..., '%a') returns 'Mon'..'Sun' — matches the frontend's
  // weekday labels exactly, so no mapping is needed on the client side.
  const rows = await query(
    'SELECT DATE_FORMAT(b.start_at, \'%a\') AS weekday, ' +
    '       HOUR(b.start_at) AS hour, ' +
    '       COUNT(*) AS cnt ' +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    ' WHERE b.trash = 0 ' +
    '   AND b.status IN (\'pending\', \'approved\', \'completed\') ' +
    '   AND b.start_at >= ? ' +
    '   AND b.start_at < DATE_ADD(?, INTERVAL 1 DAY) ' + scopeClause +
    ' GROUP BY weekday, hour ',
    [from, to, ...scopeParams]
  );

  if (rows.length === 0) {
    return ok(res, { ...emptyHeatmap(), window: { from, to } });
  }

  const cells = rows.map(function (r) {
    return { weekday: r.weekday, hour: Number(r.hour), count: Number(r.cnt) };
  });

  // Max count across all cells (used by the frontend for colour scaling).
  let maxPerSlot = 0;
  for (const c of cells) if (c.count > maxPerSlot) maxPerSlot = c.count;

  // Busiest single slot — the exact cell with the highest count.
  const busiest = cells.reduce(function (best, c) {
    return c.count > best.count ? c : best;
  }, cells[0]);
  const busiestSlot = busiest.weekday + ', ' + pad2(busiest.hour) + ':00–' + pad2(busiest.hour + 1) + ':00';

  // Busiest hour overall — sum per-hour across all days; also note the
  // day that peaks within that hour so we can label it as "10:00 · Tue".
  const byHour = new Map(); // hour -> { total, peakDay, peakCount }
  for (const c of cells) {
    const existing = byHour.get(c.hour) || { total: 0, peakDay: c.weekday, peakCount: 0 };
    existing.total += c.count;
    if (c.count > existing.peakCount) {
      existing.peakDay = c.weekday;
      existing.peakCount = c.count;
    }
    byHour.set(c.hour, existing);
  }
  let peakHourInfo = null;
  let peakHour = -1;
  for (const [h, info] of byHour) {
    if (!peakHourInfo || info.total > peakHourInfo.total) {
      peakHourInfo = info;
      peakHour = h;
    }
  }
  const busiestHourLabel = peakHourInfo
    ? pad2(peakHour) + ':00 · ' + peakHourInfo.peakDay
    : '—';

  // Quietest WORKING hour — within business hours only (8..20).
  const WORKING_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  let quietestHour = null;
  let quietestTotal = Number.POSITIVE_INFINITY;
  for (const h of WORKING_HOURS) {
    const info = byHour.get(h);
    const total = info ? info.total : 0;
    if (total < quietestTotal) {
      quietestTotal = total;
      quietestHour = h;
    }
  }
  const quietestLabel = quietestHour !== null
    ? pad2(quietestHour) + ':00–' + pad2(quietestHour + 1) + ':00'
    : '—';

  return ok(res, {
    cells,
    busiestSlot,
    busiestHour: busiestHourLabel,
    quietestWorking: quietestLabel,
    maxPerSlot,
    window: { from, to },
    as_of: new Date().toISOString(),
  });
});

function emptyHeatmap() {
  return {
    cells: [],
    busiestSlot: '—',
    busiestHour: '—',
    quietestWorking: '—',
    maxPerSlot: 0,
    window: null,
    as_of: new Date().toISOString(),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Accepts only 'YYYY-MM-DD' strings — anything else returns null so the
// controller falls back to the default window instead of accepting junk.
function parseIsoDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function isoDaysAgo(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// GET /api/dashboards/pantry-orders
//
// Aggregates the existing `booking_pantry_orders` rows (populated by the
// pantry-management module whenever a booking is created with pantry
// line-items) into the shape the SpaceDesk "Pantry orders" widget wants.
//
// NOTE: the current pantry schema doesn't track a delivery lifecycle
// (no delivery_status / delivered_at columns), so three of the six widget
// fields (`delivered`, `inProgress`, `avgDeliveryMin`) are returned as
// `null`. The widget renders those as a muted "—" placeholder. If the
// pantry module ever adds delivery tracking columns, this endpoint can
// start populating them with no API shape change.
//
// Query params (all optional):
//   tenant_id?        - super_admin only
//   organisation_id?  - scopes via sites.organisation_id
//   site_id?          - direct facility.site_id filter
//   from?, to?        - YYYY-MM-DD window; default = last 30 days
exports.pantryOrders = asyncHandler(async function (req, res) {
  // --- Scoping (same shape as peakTimes) ---
  let scopeClause = '';
  const scopeParams = [];
  let effectiveTenantId = null;
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return ok(res, emptyPantryOrders());
    effectiveTenantId = tid;
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, emptyPantryOrders());
    effectiveTenantId = req.user.tenant_id;
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(req.user.tenant_id);
  }

  // Embassy bridge opt-in. If this tenant is in the EMBASSY_TENANT_MAP,
  // proxy the whole pantry aggregation to the external bridge instead of
  // querying FM's own tables. The bridge returns the exact FM shape so no
  // widget-side change is needed.
  const pcId = config.bridge.tenantMap.get(effectiveTenantId);
  if (pcId && config.bridge.pantryUrl && config.bridge.pantrySecret) {
    const to = parseIsoDate(req.query.to) || todayIso();
    const from = parseIsoDate(req.query.from) || isoDaysAgo(to, 30);
    try {
      const bridged = await pantryBridge.fetchAggregated({ pcId, from, to });
      if (bridged) return ok(res, bridged);
      // null → bridge call failed; fall through to local DB so the widget
      // still renders something instead of 500ing.
      console.warn('[pantryOrders] bridge returned null for tenant=' + effectiveTenantId + ', pc_id=' + pcId + ' — falling back to local DB');
    } catch (err) {
      console.warn('[pantryOrders] bridge threw for tenant=' + effectiveTenantId + ':', err && err.message, '— falling back to local DB');
    }
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    scopeClause += ' AND f.site_id = ? ';
    scopeParams.push(siteId);
  }

  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    scopeClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    scopeParams.push(orgId);
  }

  const to = parseIsoDate(req.query.to) || todayIso();
  const from = parseIsoDate(req.query.from) || isoDaysAgo(to, 30);

  // Shared FROM/JOIN/WHERE used by all three aggregation queries. Only
  // non-cancelled/non-rejected bookings count — a cancelled booking's
  // pantry order was never actually fulfilled.
  const baseJoin =
    ' FROM `booking_pantry_orders` bpo ' +
    ' INNER JOIN `bookings` b ON b.id = bpo.booking_id ' +
    ' INNER JOIN `facilities` f ON f.id = b.facility_id ';
  const baseWhere =
    " WHERE b.trash = 0 AND b.status IN ('pending', 'approved', 'completed') " +
    ' AND b.start_at >= ? ' +
    ' AND b.start_at < DATE_ADD(?, INTERVAL 1 DAY) ' + scopeClause;
  const windowParams = [from, to, ...scopeParams];

  // 1) Total order rows in the window.
  const totalRow = await query(
    'SELECT COUNT(*) AS created ' + baseJoin + baseWhere,
    windowParams
  );
  const created = Number((totalRow[0] || {}).created || 0);

  if (created === 0) {
    return ok(res, { ...emptyPantryOrders(), window: { from, to } });
  }

  // 2) Daily order counts (bucket by the booking's start_at date).
  const dailyRows = await query(
    'SELECT DATE(b.start_at) AS day, COUNT(*) AS orders ' +
    baseJoin + baseWhere +
    ' GROUP BY DATE(b.start_at) ORDER BY day',
    windowParams
  );
  const daily = dailyRows.map(function (r) {
    return { day: formatDayLabel(r.day), orders: Number(r.orders) };
  });

  // 3) Top items by total quantity ordered (joins through to menu name).
  const topRows = await query(
    'SELECT pmi.name AS name, SUM(bpo.quantity) AS orders ' +
    baseJoin +
    ' INNER JOIN `pantry_menu_items` pmi ON pmi.id = bpo.menu_item_id ' +
    baseWhere +
    ' GROUP BY pmi.id, pmi.name ORDER BY orders DESC LIMIT 4',
    windowParams
  );
  const topItems = topRows.map(function (r) {
    return { name: r.name, orders: Number(r.orders), color: '#f97316' };
  });

  return ok(res, {
    created,
    delivered: null,       // delivery lifecycle not tracked yet
    inProgress: null,      // delivery lifecycle not tracked yet
    avgDeliveryMin: null,  // no delivered_at timestamp exists
    daily,
    topItems,
    window: { from, to },
    as_of: new Date().toISOString(),
  });
});

function emptyPantryOrders() {
  return {
    created: 0,
    delivered: null,
    inProgress: null,
    avgDeliveryMin: null,
    daily: [],
    topItems: [],
    window: null,
    as_of: new Date().toISOString(),
  };
}

// MySQL DATE() with dateStrings:true returns 'YYYY-MM-DD'. Convert to
// the "D MMM" label used by the dashboard mock (so the frontend doesn't
// have to know about month name formatting).
function formatDayLabel(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return String(dateStr);
  const day = Number(parts[2]);
  const monthIdx = Number(parts[1]) - 1;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  if (Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) return String(dateStr);
  return day + ' ' + months[monthIdx];
}

// GET /api/dashboards/booking-channel
//
// Donut breakdown feeding the SpaceDesk "Booking channel" widget. Groups
// non-cancelled bookings by their `channel` enum ('portal' / 'app' /
// 'qr' / 'tablet') within the window.
//
// Rows with NULL channel are rolled into 'portal' — this matches the
// migration backfill (migration 051 sets every legacy booking to 'portal'
// because /public routes are view-only and /public/checkin doesn't
// create bookings). If a future endpoint starts creating bookings with
// NULL channel by accident, those still land in the 'portal' slice.
//
// Response shape intentionally mirrors sampleData.ts ChannelSlice so the
// widget doesn't need any format conversion.
exports.bookingChannel = asyncHandler(async function (req, res) {
  // --- Scoping (same pattern as peakTimes / pantryOrders) ---
  let scopeClause = '';
  const scopeParams = [];
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return ok(res, emptyChannelPayload());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, emptyChannelPayload());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    scopeClause += ' AND f.site_id = ? ';
    scopeParams.push(siteId);
  }

  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    scopeClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    scopeParams.push(orgId);
  }

  const to = parseIsoDate(req.query.to) || todayIso();
  const from = parseIsoDate(req.query.from) || isoDaysAgo(to, 30);

  // COALESCE(channel, 'portal') folds NULL rows into the portal slice.
  const rows = await query(
    "SELECT COALESCE(b.channel, 'portal') AS channel, COUNT(*) AS cnt " +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    ' WHERE b.trash = 0 ' +
    "   AND b.status IN ('pending', 'approved', 'completed') " +
    '   AND b.start_at >= ? ' +
    '   AND b.start_at < DATE_ADD(?, INTERVAL 1 DAY) ' + scopeClause +
    ' GROUP BY channel',
    [from, to, ...scopeParams]
  );

  // Build a complete 4-slice response even if some channels have zero
  // bookings — the donut widget renders cleaner with all slices present
  // (zero slices just show as 0% in the legend).
  const counts = { portal: 0, app: 0, qr: 0, tablet: 0 };
  let total = 0;
  for (const r of rows) {
    const key = String(r.channel);
    const n = Number(r.cnt);
    if (counts[key] !== undefined) counts[key] = n;
    total += n;
  }

  // Order + colors match sampleData.ts so the widget's hard-coded colour
  // palette lines up with the sliced data.
  const slices = [
    { name: 'QR walk-in',   value: counts.qr,     color: '#8b5cf6' },
    { name: 'Mobile app',   value: counts.app,    color: '#3b82f6' },
    { name: 'Web portal',   value: counts.portal, color: '#10b981' },
    { name: 'Door tablet',  value: counts.tablet, color: '#f59e0b' },
  ];

  return ok(res, {
    slices,
    total,
    window: { from, to },
    as_of: new Date().toISOString(),
  });
});

function emptyChannelPayload() {
  return {
    slices: [
      { name: 'QR walk-in',  value: 0, color: '#8b5cf6' },
      { name: 'Mobile app',  value: 0, color: '#3b82f6' },
      { name: 'Web portal',  value: 0, color: '#10b981' },
      { name: 'Door tablet', value: 0, color: '#f59e0b' },
    ],
    total: 0,
    window: null,
    as_of: new Date().toISOString(),
  };
}

// GET /api/dashboards/feedback
//
// Powers the SpaceDesk "Feedback across facilities" widget. Returns:
//   • overall        — AVG(stars) across all ratings in window
//   • reviews        — COUNT(*) in window
//   • distribution   — [{stars: 1..5, percent}]
//   • needsAttention — per-facility rows avg stars < 4, sorted ASC, top 6
//   • topRated       — per-facility rows avg stars >= 4, sorted DESC, top 6
//
// Each facility row includes its site_name (JOINed) so the widget can show
// "Type · Site" subtitles — matches the format shown in the mock. Building
// / floor aren't surfaced in the widget today (keeps row compact) but the
// data is available via the same JOIN chain if we add them later.
//
// "Most mentioned" tag is computed in Node (not SQL) because MySQL's JSON
// aggregation is awkward across versions — the per-facility tag arrays are
// small (6 facilities × few ratings = tiny) so a client-side reduce is fine.
exports.feedback = asyncHandler(async function (req, res) {
  // --- Scoping (same pattern as peakTimes / pantryOrders) ---
  let scopeClause = '';
  const scopeParams = [];
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return ok(res, emptyFeedbackPayload());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, emptyFeedbackPayload());
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    scopeClause += ' AND f.site_id = ? ';
    scopeParams.push(siteId);
  }

  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    scopeClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    scopeParams.push(orgId);
  }

  const to = parseIsoDate(req.query.to) || todayIso();
  const from = parseIsoDate(req.query.from) || isoDaysAgo(to, 30);
  const windowParams = [from, to, ...scopeParams];

  // 1) Overall averages + distribution — one pass over the rating rows.
  const overallRows = await query(
    'SELECT r.stars, COUNT(*) AS cnt ' +
    '  FROM `facility_ratings` r ' +
    '  INNER JOIN `facilities` f ON f.id = r.facility_id ' +
    ' WHERE r.created_at >= ? AND r.created_at < DATE_ADD(?, INTERVAL 1 DAY) ' + scopeClause +
    ' GROUP BY r.stars',
    windowParams
  );
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let reviews = 0;
  let starsSum = 0;
  for (const row of overallRows) {
    const star = Number(row.stars);
    const cnt = Number(row.cnt);
    if (counts[star] !== undefined) counts[star] = cnt;
    reviews += cnt;
    starsSum += star * cnt;
  }

  if (reviews === 0) {
    return ok(res, { ...emptyFeedbackPayload(), window: { from, to } });
  }

  const overall = Number((starsSum / reviews).toFixed(1));
  const distribution = [5, 4, 3, 2, 1].map(function (stars) {
    return {
      stars,
      percent: reviews > 0 ? Math.round((counts[stars] / reviews) * 100) : 0,
    };
  });

  // 2) Per-facility averages — pulls facility metadata via JOIN so we don't
  //    need a second query to look up names/types/sites.
  const facilityRows = await query(
    'SELECT f.id AS facility_id, f.name AS facility_name, f.type AS facility_type, ' +
    '       s.name AS site_name, ' +
    '       AVG(r.stars) AS avg_stars, COUNT(*) AS review_count ' +
    '  FROM `facility_ratings` r ' +
    '  INNER JOIN `facilities` f ON f.id = r.facility_id ' +
    '  INNER JOIN `sites` s ON s.id = f.site_id ' +
    ' WHERE r.created_at >= ? AND r.created_at < DATE_ADD(?, INTERVAL 1 DAY) ' + scopeClause +
    ' GROUP BY f.id, f.name, f.type, s.name ' +
    ' ORDER BY avg_stars',
    windowParams
  );

  // 3) Tag frequencies — one row per rating, we aggregate in JS.
  const tagRows = await query(
    'SELECT r.facility_id, r.tags ' +
    '  FROM `facility_ratings` r ' +
    '  INNER JOIN `facilities` f ON f.id = r.facility_id ' +
    ' WHERE r.created_at >= ? AND r.created_at < DATE_ADD(?, INTERVAL 1 DAY) ' +
    '   AND r.tags IS NOT NULL ' + scopeClause,
    windowParams
  );
  const topTagByFacility = computeTopTagPerFacility(tagRows);

  // 4) Shape the facility rows into widget format + bucket into
  //    needs-attention vs top-rated.
  const needs = [];
  const top = [];
  for (const row of facilityRows) {
    const avg = Number(Number(row.avg_stars).toFixed(1));
    const entry = {
      initials: makeInitials(row.facility_name),
      name: row.facility_name,
      type: row.facility_type,
      site: row.site_name || '',
      rating: avg,
      reviews: Number(row.review_count),
      mostMentioned: topTagByFacility.get(row.facility_id) || '',
    };
    if (avg < 4) needs.push(entry); else top.push(entry);
  }

  // needs is already ASC by avg_stars from SQL; top needs reversing to DESC.
  top.sort(function (a, b) { return b.rating - a.rating; });

  return ok(res, {
    overall,
    reviews,
    distribution,
    needsAttention: needs.slice(0, 6),
    topRated: top.slice(0, 6),
    window: { from, to },
    as_of: new Date().toISOString(),
  });
});

function emptyFeedbackPayload() {
  return {
    overall: 0,
    reviews: 0,
    distribution: [
      { stars: 5, percent: 0 }, { stars: 4, percent: 0 }, { stars: 3, percent: 0 },
      { stars: 2, percent: 0 }, { stars: 1, percent: 0 },
    ],
    needsAttention: [],
    topRated: [],
    window: null,
    as_of: new Date().toISOString(),
  };
}

// Collapse a facility name like "Pune Tech Park" to a 2-letter avatar.
function makeInitials(name) {
  if (!name) return '??';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Normalise MySQL JSON values (string | parsed array | null) to an array.
function parseTagsJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

// Live activity feed. Unions four event streams within the active tenant
// (optionally narrowed by site / organisation) and returns the latest N
// events sorted by timestamp DESC:
//
//   1. booking   — bookings.created_at                 (someone booked)
//   2. checkin   — bookings.checked_in_at IS NOT NULL  (QR arrival)
//   3. rating    — facility_ratings.created_at         (feedback submitted)
//   4. pantry    — bookings with pantry orders         (uses booking.created_at
//                                                       because the join
//                                                       table has no timestamp)
//
// The response shape matches the UI widget's ActivityItem exactly:
//   { id, icon, title, description, ago, ts }
// where `ts` is ISO so the frontend can recompute "ago" if the panel sits
// open for a while.
exports.recentActivity = asyncHandler(async function (req, res) {
  // --- Scoping (same pattern as bookingChannel / pantryOrders) ---
  let scopeClause = '';
  const scopeParams = [];
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return ok(res, { items: [], as_of: new Date().toISOString() });
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(tid);
  } else {
    if (!req.user.tenant_id) return ok(res, { items: [], as_of: new Date().toISOString() });
    scopeClause += ' AND f.tenant_id = ? ';
    scopeParams.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) {
    scopeClause += ' AND f.site_id = ? ';
    scopeParams.push(siteId);
  }

  const orgId = intOrNull(req.query.organisation_id);
  if (orgId !== null) {
    scopeClause += ' AND f.site_id IN (SELECT id FROM `sites` WHERE organisation_id = ?) ';
    scopeParams.push(orgId);
  }

  // Pull more than we need per stream so merging still has enough to fill
  // the final limit even if one stream dominates (e.g. 50 new bookings
  // and only 2 ratings). The merged slice then trims to `limit`.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const perStream = limit * 2;

  // --- 1) New bookings (sorted by created_at desc) --------------------
  const bookingRows = await query(
    "SELECT b.id, b.created_at AS ts, b.channel, b.start_at, b.end_at, " +
    "       f.name AS facility_name, s.name AS site_name, " +
    "       TRIM(CONCAT_WS(' ', u.name, u.lname)) AS actor_name, u.username AS actor_username " +
    "  FROM `bookings` b " +
    "  INNER JOIN `facilities` f ON f.id = b.facility_id " +
    "  LEFT JOIN `sites` s ON s.id = f.site_id " +
    "  INNER JOIN `users` u ON u.id = b.user_id " +
    " WHERE b.trash = 0 " + scopeClause +
    " ORDER BY b.created_at DESC LIMIT " + perStream,
    scopeParams
  );

  // --- 2) Check-ins (sorted by checked_in_at desc) --------------------
  const checkinRows = await query(
    "SELECT b.id, b.checked_in_at AS ts, b.start_at, " +
    "       f.name AS facility_name, s.name AS site_name, " +
    "       TRIM(CONCAT_WS(' ', u.name, u.lname)) AS actor_name, u.username AS actor_username " +
    "  FROM `bookings` b " +
    "  INNER JOIN `facilities` f ON f.id = b.facility_id " +
    "  LEFT JOIN `sites` s ON s.id = f.site_id " +
    "  INNER JOIN `users` u ON u.id = b.user_id " +
    " WHERE b.trash = 0 AND b.checked_in_at IS NOT NULL " + scopeClause +
    " ORDER BY b.checked_in_at DESC LIMIT " + perStream,
    scopeParams
  );

  // --- 3) Ratings (sorted by created_at desc) -------------------------
  const ratingRows = await query(
    "SELECT r.id, r.created_at AS ts, r.stars, r.comment, " +
    "       f.name AS facility_name, s.name AS site_name, " +
    "       TRIM(CONCAT_WS(' ', u.name, u.lname)) AS actor_name, u.username AS actor_username " +
    "  FROM `facility_ratings` r " +
    "  INNER JOIN `facilities` f ON f.id = r.facility_id " +
    "  LEFT JOIN `sites` s ON s.id = f.site_id " +
    "  INNER JOIN `users` u ON u.id = r.user_id " +
    " WHERE 1=1 " + scopeClause +
    " ORDER BY r.created_at DESC LIMIT " + perStream,
    scopeParams
  );

  // --- 4) Pantry orders (grouped per booking; booking.created_at is the
  //         best proxy since booking_pantry_orders has no own timestamp)
  const pantryRows = await query(
    "SELECT b.id, b.created_at AS ts, " +
    "       SUM(bpo.quantity) AS total_qty, COUNT(*) AS line_count, " +
    "       MIN(pmi.name) AS sample_item, " +
    "       f.name AS facility_name, s.name AS site_name, " +
    "       TRIM(CONCAT_WS(' ', u.name, u.lname)) AS actor_name, u.username AS actor_username " +
    "  FROM `booking_pantry_orders` bpo " +
    "  INNER JOIN `bookings` b ON b.id = bpo.booking_id " +
    "  INNER JOIN `facilities` f ON f.id = b.facility_id " +
    "  LEFT JOIN `sites` s ON s.id = f.site_id " +
    "  INNER JOIN `users` u ON u.id = b.user_id " +
    "  INNER JOIN `pantry_menu_items` pmi ON pmi.id = bpo.menu_item_id " +
    " WHERE b.trash = 0 " + scopeClause +
    " GROUP BY b.id, b.created_at, f.name, s.name, actor_name, u.username " +
    " ORDER BY b.created_at DESC LIMIT " + perStream,
    scopeParams
  );

  // --- Merge into a single feed ---------------------------------------
  const events = [];

  for (const r of bookingRows) {
    const actor = r.actor_name || r.actor_username || 'Someone';
    const target = r.facility_name || 'facility';
    const channel = channelLabel(r.channel);
    events.push({
      id: 'b-' + r.id,
      icon: 'booking',
      title: '**' + actor + '** booked **' + target + '**',
      description: channel + ' · ' + formatBookingSlot(r.start_at, r.end_at)
                   + (r.site_name ? ' · ' + r.site_name : ''),
      ts: isoFromDb(r.ts),
    });
  }

  for (const r of checkinRows) {
    const actor = r.actor_name || r.actor_username || 'Someone';
    const target = r.facility_name || 'facility';
    const lateness = computeLateness(r.start_at, r.ts);
    events.push({
      id: 'c-' + r.id,
      icon: 'checkin',
      title: '**' + actor + '** checked in to **' + target + '**',
      description: 'QR scan · ' + lateness
                   + (r.site_name ? ' · ' + r.site_name : ''),
      ts: isoFromDb(r.ts),
    });
  }

  for (const r of ratingRows) {
    const actor = r.actor_name || r.actor_username || 'Someone';
    const target = r.facility_name || 'facility';
    const stars = Number(r.stars) || 0;
    const tail = r.comment
      ? '"' + String(r.comment).slice(0, 60) + '"'
      : (r.site_name || '');
    events.push({
      id: 'r-' + r.id,
      icon: 'rating',
      title: '**' + actor + '** rated **' + target + '** ' + stars + '★',
      description: tail,
      ts: isoFromDb(r.ts),
    });
  }

  for (const r of pantryRows) {
    const target = r.facility_name || 'facility';
    const actor = r.actor_name || r.actor_username || 'Someone';
    const totalQty = Number(r.total_qty) || 0;
    const sample = r.sample_item || 'items';
    const extra = Number(r.line_count) > 1 ? ' + more' : '';
    events.push({
      id: 'p-' + r.id,
      icon: 'pantry',
      title: 'Pantry order for **' + target + '**',
      description: totalQty + ' × ' + sample + extra + ' · by ' + actor
                   + (r.site_name ? ' · ' + r.site_name : ''),
      ts: isoFromDb(r.ts),
    });
  }

  // Sort combined by timestamp desc. Rows without a parseable ts fall
  // to the bottom.
  events.sort(function (a, b) {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    return tb - ta;
  });

  const items = events.slice(0, limit).map(function (e) {
    return {
      id: e.id,
      icon: e.icon,
      title: e.title,
      description: e.description,
      ago: relativeAgo(e.ts),
      ts: e.ts,
    };
  });

  return ok(res, { items, as_of: new Date().toISOString() });
});

// Humanise bookings.channel for the feed description.
function channelLabel(c) {
  const v = String(c || 'portal').toLowerCase();
  if (v === 'qr')     return 'QR walk-in';
  if (v === 'app')    return 'Mobile app';
  if (v === 'tablet') return 'Door tablet';
  return 'Web portal';
}

// "14:00 for 60 min" — matches the shape used in mock sample data.
function formatBookingSlot(startAt, endAt) {
  const s = parseDbDate(startAt);
  const e = parseDbDate(endAt);
  if (!s || !e) return '';
  const hh = String(s.getHours()).padStart(2, '0');
  const mm = String(s.getMinutes()).padStart(2, '0');
  const minutes = Math.round((e.getTime() - s.getTime()) / 60000);
  return hh + ':' + mm + ' for ' + minutes + ' min';
}

// "on time", "N min early", "N min late".
function computeLateness(startAt, checkinAt) {
  const s = parseDbDate(startAt);
  const c = parseDbDate(checkinAt);
  if (!s || !c) return 'on time';
  const delta = Math.round((c.getTime() - s.getTime()) / 60000);
  if (delta <= -1) return Math.abs(delta) + ' min early';
  if (delta >= 1)  return delta + ' min late';
  return 'on time';
}

function parseDbDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoFromDb(v) {
  const d = parseDbDate(v);
  return d ? d.toISOString() : null;
}

// Compact relative-time ("3m ago", "2h ago", "4d ago"). The frontend widget
// can rely on this directly without needing a date library; it also receives
// the raw ISO so it can refresh if the user keeps the panel open.
function relativeAgo(iso) {
  if (!iso) return '';
  const now = Date.now();
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(1, Math.round((now - t) / 1000));
  if (sec < 60)      return sec + 's ago';
  const min = Math.round(sec / 60);
  if (min < 60)      return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 24)       return hr + 'h ago';
  const day = Math.round(hr / 24);
  if (day < 7)       return day + 'd ago';
  const wk = Math.round(day / 7);
  if (wk < 5)        return wk + 'w ago';
  const mo = Math.round(day / 30);
  if (mo < 12)       return mo + 'mo ago';
  const yr = Math.round(day / 365);
  return yr + 'y ago';
}

// Per-facility tag frequency → the single highest-count tag per facility.
// Ties broken by first-seen order (consistent across calls on sorted input).
function computeTopTagPerFacility(tagRows) {
  const perFacility = new Map(); // facility_id -> Map(tag -> count)
  for (const row of tagRows) {
    const tags = parseTagsJson(row.tags);
    if (tags.length === 0) continue;
    let bucket = perFacility.get(row.facility_id);
    if (!bucket) {
      bucket = new Map();
      perFacility.set(row.facility_id, bucket);
    }
    for (const t of tags) {
      bucket.set(t, (bucket.get(t) || 0) + 1);
    }
  }
  const top = new Map();
  for (const [facilityId, bucket] of perFacility) {
    let bestTag = '';
    let bestCount = 0;
    for (const [tag, count] of bucket) {
      if (count > bestCount) { bestCount = count; bestTag = tag; }
    }
    if (bestTag) top.set(facilityId, bestTag);
  }
  return top;
}
