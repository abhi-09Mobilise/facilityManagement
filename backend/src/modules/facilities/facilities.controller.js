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
  const stageVal = stage === 'checkout' ? 'checkout' : 'checkin';
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
    'SELECT f.id, f.tenant_id, f.site_id, f.floor_id, f.name, f.type, f.capacity, ' +
    '       f.description, f.image_url, f.requires_approval, f.shared_booking, ' +
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

  const newId = await withTransaction(async function (conn) {
    const [r] = await conn.execute(
      'INSERT INTO `facilities` (tenant_id, site_id, floor_id, name, type, capacity, ' +
      '       description, image_url, requires_approval, shared_booking, facility_approver_user_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        site.row.tenant_id, site.row.id, floorId,
        b.name, b.type, intOrNull(b.capacity) || 0,
        b.description || null, b.image_url || null,
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

  await execute(
    'UPDATE `facilities` SET ' +
    '  name                       = COALESCE(?, name), ' +
    '  type                       = COALESCE(?, type), ' +
    '  floor_id                   = COALESCE(?, floor_id), ' +
    '  capacity                   = COALESCE(?, capacity), ' +
    '  description                = COALESCE(?, description), ' +
    '  image_url                  = COALESCE(?, image_url), ' +
    '  requires_approval          = COALESCE(?, requires_approval), ' +
    '  shared_booking             = COALESCE(?, shared_booking), ' +
    '  facility_approver_user_id  = ' + (hasApprover ? '?' : 'facility_approver_user_id') + ', ' +
    '  status                     = COALESCE(?, status) ' +
    'WHERE id = ?',
    hasApprover ? [
      b.name || null, b.type || null, intOrNull(b.floor_id), intOrNull(b.capacity),
      b.description || null, b.image_url || null,
      intOrNull(b.requires_approval), sharedVal, newApprover, intOrNull(b.status), id,
    ] : [
      b.name || null, b.type || null, intOrNull(b.floor_id), intOrNull(b.capacity),
      b.description || null, b.image_url || null,
      intOrNull(b.requires_approval), sharedVal, intOrNull(b.status), id,
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
    '  FROM `facility_operating_hours` WHERE facility_id = ? ORDER BY day_of_week',
    [id]
  );
  return ok(res, rows);
});

// // Exported for facilityChains module so we don't have to query in two places.
// exports._loadChain = loadChain;
// e_time, slot_minutes ' +
//     '  FROM `facility_operating_hours` WHERE facility_id = ? ORDER BY day_of_week, open_time',
//     [id]
//   );
//   return ok(res, rows);
// });

exports._loadChain = loadChain;
