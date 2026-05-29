// Facilities CRUD + nested operating_hours + per-facility approval chain.
//
// New since migration 019:
//   - facilities.facility_approver_user_id      ("the facility person")
//   - facility_approval_chains rows             (the chain UI on facility form)
//
// When a facility is created, two default chain rows are inserted:
//   1. dynamic_dept_manager   (resolved at booking time from booker -> dept -> manager)
//   2. user:facility_approver_user_id  (only if that field was provided)

const { query, execute, withTransaction } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, assertOwnership } = require('../../utils/tenantScope');

const VALID_TYPES = ['meeting_room','gym','conference_room','desk','swimming_pool','other'];

// Helper: load the chain rows for a facility, joined to the approver user
// (for `user`-kind rows). Used by getOne + facilityChains.list.
// F02 - second arg `stage` defaults to 'checkin' (so getOne's chain remains
// the pre-booking workflow). Pass 'checkout' to load the post-booking chain.
async function loadChain(facilityId, stage) {
  // F09 - 'notification' is a third stage for FYI-only recipients; defaults
  // remain 'checkin' so existing callers stay untouched.
  const stageVal =
    stage === 'checkout'     ? 'checkout'
    : stage === 'notification' ? 'notification'
    : stage === 'cleanup'      ? 'cleanup'
    : 'checkin';
  return query(
    'SELECT c.id, c.facility_id, c.stage, c.step_order, c.approver_kind, c.approver_user_id, ' +
    '       u.name AS approver_name, u.lname AS approver_lname, u.username AS approver_username, ' +
    '       u.email AS approver_email, u.designation AS approver_designation ' +
    '  FROM `facility_approval_chains` c ' +
    '  LEFT JOIN `users` u ON u.id = c.approver_user_id ' +
    ' WHERE c.facility_id = ? AND c.stage = ? ' +
    ' ORDER BY c.step_order',
    [facilityId, stageVal]
  );
}

exports.list = asyncHandler(async function (req, res) {
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['f.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('f.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('f.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) { where.push('f.site_id = ?'); params.push(siteId); }

  if (req.query.type) { where.push('f.type = ?'); params.push(req.query.type); }
  if (req.query.q)    {
    where.push('f.name LIKE ?');
    params.push('%' + req.query.q + '%');
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `facilities` f WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT f.id, f.tenant_id, f.site_id, f.floor_id, f.name, f.type, f.capacity, f.offline_capacity, ' +
    '       f.min_advance_minutes, f.max_advance_days, f.max_per_user_per_day, ' +
    '       f.max_per_user_per_week, f.max_per_user_per_month, ' +
    '       f.pre_end_notify_minutes, ' +
    '       f.description, f.image_url, f.layout_json, f.requires_approval, f.shared_booking, ' +
    '       f.facility_approver_user_id, f.public_listed, ' +
    '       f.status, f.created_at, ' +
    '       t.name AS tenant_name, s.name AS site_name, fl.name AS floor_name ' +
    '  FROM `facilities` f ' +
    '  LEFT JOIN `tenants` t  ON t.id  = f.tenant_id ' +
    '  LEFT JOIN `sites`   s  ON s.id  = f.site_id ' +
    '  LEFT JOIN `floors`  fl ON fl.id = f.floor_id ' +
    ' WHERE ' + whereSql +
    ` ORDER BY f.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok(res, { data: rows, total: total, current_page: page, per_page: limit });
});

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const [hours, chain] = await Promise.all([
    query(
      'SELECT id, day_of_week, open_time, close_time, slot_minutes ' +
      '  FROM `facility_operating_hours` WHERE facility_id = ? ORDER BY day_of_week',
      [id]
    ),
    loadChain(id),
  ]);
  return ok(res, Object.assign({}, r.row, { operating_hours: hours, approval_chain: chain }));
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name)                          return fail(res, 'name is required', 422);
  if (!b.type || !VALID_TYPES.includes(b.type))
                                        return fail(res, 'type is required and must be one of: ' + VALID_TYPES.join(', '), 422);
  if (!b.site_id)                       return fail(res, 'site_id is required', 422);

  const site = await assertOwnership(req, 'sites', intOrNull(b.site_id));
  if (!site.ok) return fail(res, site.msg, site.status);

  let floorId = intOrNull(b.floor_id);
  if (floorId !== null) {
    const floor = await assertOwnership(req, 'floors', floorId);
    if (!floor.ok || floor.row.tenant_id !== site.row.tenant_id) {
      return fail(res, 'floor_id is not valid for this tenant/site', 422);
    }
  }

  // facility_approver_user_id, when given, must belong to the same tenant.
  const facilityApproverId = intOrNull(b.facility_approver_user_id);
  if (facilityApproverId !== null) {
    const rows = await query(
      'SELECT id FROM `users` WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
      [facilityApproverId, site.row.tenant_id]
    );
    if (rows.length === 0) return fail(res, 'facility_approver_user_id is not a valid user in this tenant', 422);
  }

  // Sanitise advance-booking rule inputs. Each is optional; null = no rule.
  // Negative values are coerced to null (treat "-1" the same as blank).
  function ruleVal(v) {
    const n = intOrNull(v);
    if (n === null) return null;
    return n < 0 ? null : n;
  }
  const minAdvMin    = ruleVal(b.min_advance_minutes);
  const maxAdvDays   = ruleVal(b.max_advance_days);
  const maxPerDay    = ruleVal(b.max_per_user_per_day);
  const maxPerWeek   = ruleVal(b.max_per_user_per_week);
  const maxPerMonth  = ruleVal(b.max_per_user_per_month);
  // Pre-end cleanup notification lead time (minutes before end_at).
  // NULL/0 disables the feature for the facility.
  const preEndMin    = ruleVal(b.pre_end_notify_minutes);

  const newId = await withTransaction(async function (conn) {
    // Clamp offline_capacity to [0, capacity] so we never end up with a
    // facility whose offline reservation exceeds its total seat count.
    const capVal     = intOrNull(b.capacity) || 0;
    const offlineRaw = intOrNull(b.offline_capacity) || 0;
    const offlineVal = Math.max(0, Math.min(capVal, offlineRaw));

    const [r] = await conn.execute(
      'INSERT INTO `facilities` (tenant_id, site_id, floor_id, name, type, capacity, offline_capacity, ' +
      '       min_advance_minutes, max_advance_days, max_per_user_per_day, ' +
      '       max_per_user_per_week, max_per_user_per_month, pre_end_notify_minutes, ' +
      '       description, image_url, layout_json, requires_approval, shared_booking, facility_approver_user_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        site.row.tenant_id, site.row.id, floorId,
        b.name, b.type, capVal, offlineVal,
        minAdvMin, maxAdvDays, maxPerDay, maxPerWeek, maxPerMonth, preEndMin,
        b.description || null, b.image_url || null,
        b.layout_json ? (typeof b.layout_json === 'string' ? b.layout_json : JSON.stringify(b.layout_json)) : null,
        b.requires_approval ? 1 : 0,
        b.shared_booking ? 1 : 0,
        facilityApproverId,
      ]
    );
    const facilityId = r.insertId;

    // Default chain: step 1 = dept manager, step 2 = facility approver (if set).
    // The UI on the facility form can replace this entire chain via PUT
    // /api/facilities/:id/chain after create if the admin wants something
    // different.
    await conn.execute(
      "INSERT INTO `facility_approval_chains` (facility_id, step_order, approver_kind, approver_user_id) " +
      "VALUES (?, 1, 'dynamic_dept_manager', NULL)",
      [facilityId]
    );
    if (facilityApproverId !== null) {
      await conn.execute(
        "INSERT INTO `facility_approval_chains` (facility_id, step_order, approver_kind, approver_user_id) " +
        "VALUES (?, 2, 'user', ?)",
        [facilityId, facilityApproverId]
      );
    }
    return facilityId;
  });

  return created(res, { id: newId }, 'Facility created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const b = req.body || {};
  if (b.type && !VALID_TYPES.includes(b.type)) {
    return fail(res, 'type must be one of: ' + VALID_TYPES.join(', '), 422);
  }

  // Allow nulling facility_approver_user_id by passing null explicitly.
  // Distinguish "not provided" (undefined) from "set to null".
  const hasApprover = Object.prototype.hasOwnProperty.call(b, 'facility_approver_user_id');
  const newApprover = hasApprover ? intOrNull(b.facility_approver_user_id) : undefined;
  if (hasApprover && newApprover !== null) {
    const rows = await query(
      'SELECT id FROM `users` WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
      [newApprover, r.row.tenant_id]
    );
    if (rows.length === 0) return fail(res, 'facility_approver_user_id is not a valid user in this tenant', 422);
  }

  // shared_booking is a hard 0/1 flag; treat undefined as "leave alone" so
  // partial PATCH-style updates don't clobber it.
  const hasShared = Object.prototype.hasOwnProperty.call(b, 'shared_booking');
  const sharedVal = hasShared ? (b.shared_booking ? 1 : 0) : null;

  // F09 - layout_json. Pass null to "leave alone"; empty string clears it.
  const hasLayout = Object.prototype.hasOwnProperty.call(b, 'layout_json');
  const layoutVal = hasLayout
    ? (b.layout_json == null ? null : (typeof b.layout_json === 'string' ? b.layout_json : JSON.stringify(b.layout_json)))
    : null;

  // Advance-booking rules: each is nullable INT. Treat key-not-present as
  // "leave alone"; key-present-with-null-or-empty as "clear" (no limit);
  // a non-negative number as "set"; negative → clear.
  function ruleField(key) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return { present: false, value: null };
    }
    const raw = b[key];
    if (raw === null || raw === '' || raw === undefined) {
      return { present: true, value: null };
    }
    const n = intOrNull(raw);
    if (n === null || n < 0) return { present: true, value: null };
    return { present: true, value: n };
  }
  const fMin   = ruleField('min_advance_minutes');
  const fDays  = ruleField('max_advance_days');
  const fDay   = ruleField('max_per_user_per_day');
  const fWeek  = ruleField('max_per_user_per_week');
  const fMonth = ruleField('max_per_user_per_month');
  const fPre   = ruleField('pre_end_notify_minutes');

  await execute(
    'UPDATE `facilities` SET ' +
    '  name                       = COALESCE(?, name), ' +
    '  type                       = COALESCE(?, type), ' +
    '  floor_id                   = COALESCE(?, floor_id), ' +
    '  capacity                   = COALESCE(?, capacity), ' +
    '  offline_capacity           = COALESCE(?, offline_capacity), ' +
    '  min_advance_minutes        = ' + (fMin.present   ? '?' : 'min_advance_minutes')    + ', ' +
    '  max_advance_days           = ' + (fDays.present  ? '?' : 'max_advance_days')       + ', ' +
    '  max_per_user_per_day       = ' + (fDay.present   ? '?' : 'max_per_user_per_day')   + ', ' +
    '  max_per_user_per_week      = ' + (fWeek.present  ? '?' : 'max_per_user_per_week')  + ', ' +
    '  max_per_user_per_month     = ' + (fMonth.present ? '?' : 'max_per_user_per_month') + ', ' +
    '  pre_end_notify_minutes     = ' + (fPre.present   ? '?' : 'pre_end_notify_minutes')   + ', ' +
    '  description                = COALESCE(?, description), ' +
    '  image_url                  = COALESCE(?, image_url), ' +
    '  layout_json                = ' + (hasLayout ? '?' : 'layout_json') + ', ' +
    '  requires_approval          = COALESCE(?, requires_approval), ' +
    '  shared_booking             = COALESCE(?, shared_booking), ' +
    '  facility_approver_user_id  = ' + (hasApprover ? '?' : 'facility_approver_user_id') + ', ' +
    '  status                     = COALESCE(?, status) ' +
    'WHERE id = ?',
    [
      b.name || null, b.type || null, intOrNull(b.floor_id), intOrNull(b.capacity),
      intOrNull(b.offline_capacity),
      ...(fMin.present   ? [fMin.value]   : []),
      ...(fDays.present  ? [fDays.value]  : []),
      ...(fDay.present   ? [fDay.value]   : []),
      ...(fWeek.present  ? [fWeek.value]  : []),
      ...(fMonth.present ? [fMonth.value] : []),
      ...(fPre.present   ? [fPre.value]   : []),
      b.description || null, b.image_url || null,
      ...(hasLayout ? [layoutVal] : []),
      intOrNull(b.requires_approval), sharedVal,
      ...(hasApprover ? [newApprover] : []),
      intOrNull(b.status), id,
    ]
  );
  return ok(res, null, 'Facility updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  await execute('UPDATE `facilities` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Facility deleted');
});

// Nested: operating hours

exports.replaceHours = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid facility id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const hours = Array.isArray(req.body && req.body.hours) ? req.body.hours : [];
  for (const h of hours) {
    const dow = intOrNull(h.day_of_week);
    if (dow === null || dow < 0 || dow > 6) {
      return fail(res, 'day_of_week must be 0-6 for every row', 422);
    }
    if (!h.open_time || !h.close_time) {
      return fail(res, 'open_time and close_time are required for every row', 422);
    }
  }

  await withTransaction(async function (conn) {
    await conn.execute('DELETE FROM `facility_operating_hours` WHERE facility_id = ?', [id]);
    for (const h of hours) {
      await conn.execute(
        'INSERT INTO `facility_operating_hours` (facility_id, day_of_week, open_time, close_time, slot_minutes) ' +
        'VALUES (?, ?, ?, ?, ?)',
        [
          id, intOrNull(h.day_of_week), h.open_time, h.close_time,
          intOrNull(h.slot_minutes) || 30,
        ]
      );
    }
  });
  return ok(res, null, 'Operating hours saved');
});

exports.listHours = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid facility id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  const rows = await query(
    'SELECT id, day_of_week, open_time, close_time, slot_minutes ' +
    '  FROM `facility_operating_hours` WHERE facility_id = ? ORDER BY day_of_week, open_time',
    [id]
  );
  return ok(res, rows);
});

exports._loadChain = loadChain;

// F09 - Chair delete guard.
// GET /api/facilities/:id/chair-bookings?chair_id=C-03
// Counts active future bookings holding the chair (single or comma-joined
// desk_id list). Cancelled / rejected / past bookings don't count.
exports.chairBookings = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const chairId = String(req.query.chair_id || '').trim();
  if (!chairId) return fail(res, 'chair_id is required', 422);

  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const rows = await query(
    'SELECT COUNT(*) AS cnt ' +
    '  FROM `bookings` ' +
    ' WHERE facility_id = ? AND trash = 0 ' +
    "   AND status IN ('pending','approved') " +
    "   AND end_at > NOW() " +
    "   AND FIND_IN_SET(?, REPLACE(IFNULL(desk_id, ''), ' ', '')) > 0",
    [id, chairId]
  );
  return ok(res, { count: Number(rows[0]?.cnt || 0), chair_id: chairId });
});
