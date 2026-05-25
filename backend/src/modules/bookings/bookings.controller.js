// Bookings CRUD.
//
//   POST   /api/bookings            - employee/approver creates a booking
//   GET    /api/bookings            - list (own bookings by default; ?scope=tenant
//                                     for admins; ?scope=team for dept managers)
//   GET    /api/bookings/check      - capacity / conflict pre-flight
//   GET    /api/bookings/:id        - one with guests + meals + approvals
//   POST   /api/bookings/:id/cancel - booker cancels
//
// Capacity model (migration 021):
//   - facilities.shared_booking = 0 (default): exclusive. Any overlapping
//     pending/approved/completed booking blocks the slot.
//   - facilities.shared_booking = 1: multiple bookings can co-exist as long
//     as SUM(attendee_count) over any overlapping minute stays <= capacity.
//
// Race-safety: bookings.create runs the post-INSERT capacity SUM with
// FOR SHARE inside the same transaction. InnoDB's gap locks on the
// (facility_id, status, start_at, end_at) range force concurrent inserts
// to serialise: the second tx either sees the first row in its sum (and
// rolls back if over capacity) or blocks until the first commits.

const { query, withTransaction } = require('../../db/pool');
const { ok, created, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');
const { materializeChain } = require('./chainMaterializer');
const { issueToken } = require('../../utils/approvalActionTokens');
const bookingActionTokens = require('../../utils/bookingActionTokens');
const slotOverrides = require('../facilities/slotOverrides.controller'); // F01 effectiveCapacity
const mailer = require('../../utils/mailer');

const VALID_REPEAT = ['none', 'daily', 'weekly_wed', 'custom'];

function tenantScopeWhere(req, alias = 'b') {
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    return tid !== null
      ? { sql: ` AND ${alias}.tenant_id = ?`, params: [tid] }
      : { sql: '', params: [] };
  }
  return { sql: ` AND ${alias}.tenant_id = ?`, params: [req.user.tenant_id] };
}

async function loadBooker(userId) {
  const rows = await query(
    'SELECT id, tenant_id, department_id, name, lname, email ' +
    '  FROM `users` WHERE id = ? AND trash = 0 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function loadFacility(facilityId) {
  const rows = await query(
    'SELECT id, tenant_id, site_id, name, type, capacity, requires_approval, ' +
    '       shared_booking, status, trash ' +
    '  FROM `facilities` WHERE id = ? LIMIT 1',
    [facilityId]
  );
  return rows[0] || null;
}

/**
 * Sum attendee_count of all live bookings that overlap [startAt, endAt) for
 * a facility. Optionally excludes one booking id (used when probing a slot
 * during an edit — we don't actually edit today, but the param is here so
 * the helper is reusable).
 *
 * runner: either the global `query` helper (read-only probes outside a txn)
 * or a connection's `execute` (inside a txn). When runner is a conn we want
 * FOR SHARE so the txn gap-locks the window.
 */
async function sumOverlapAttendees(runner, facilityId, startAt, endAt, opts = {}) {
  const { excludeBookingId = null, forShare = false } = opts;
  const params = [facilityId, endAt, startAt];
  let sql =
    'SELECT COALESCE(SUM(attendee_count), 0) AS total ' +
    '  FROM `bookings` ' +
    " WHERE facility_id = ? AND trash = 0 " +
    "   AND status IN ('pending', 'approved', 'completed') " +
    '   AND start_at < ? AND end_at > ? ';
  if (excludeBookingId) { sql += 'AND id <> ? '; params.push(excludeBookingId); }
  if (forShare) sql += 'FOR SHARE';

  // Two callers: `query()` returns rows directly; `conn.execute()` returns
  // [rows, fields]. Normalise.
  const result = await runner(sql, params);
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Number(rows[0]?.total || 0);
}

/**
 * Computes availability for a candidate slot.
 *
 * For exclusive facilities: same semantics as the old hasConflict — any
 * overlap fails.
 * For shared facilities: succeeds as long as
 * existing_attendees + needAttendees <= capacity.
 *
 * Returns { ok, mode, capacity, seatsTaken, seatsRemaining }.
 */
async function checkAvailability(facility, startAt, endAt, needAttendees = 1, opts = {}) {
  // F01 - resolve effective capacity from per-slot overrides if any match.
  const eff = await slotOverrides.effectiveCapacity(facility.id, startAt, endAt);
  const capacity = Math.max(0, Number(eff.matched ? eff.max : facility.capacity) || 0);
  const minAttendees = eff.matched ? Number(eff.min) : 1;
  const mode = facility.shared_booking ? 'shared' : 'exclusive';
  const taken = await sumOverlapAttendees(query, facility.id, startAt, endAt, opts);

  // Below-min party for this slot is rejected regardless of capacity.
  if (needAttendees < minAttendees) {
    return {
      ok: false,
      mode, capacity,
      seatsTaken: taken,
      seatsRemaining: Math.max(0, capacity - taken),
      minAttendees,
      reason: 'BELOW_MIN',
    };
  }

  if (mode === 'exclusive') {
    return {
      ok: taken === 0,
      mode, capacity,
      seatsTaken: taken,
      seatsRemaining: taken === 0 ? capacity : 0,
      minAttendees,
    };
  }
  const remaining = Math.max(0, capacity - taken);
  return {
    ok: (taken + needAttendees) <= capacity,
    mode, capacity,
    seatsTaken: taken,
    seatsRemaining: remaining,
    minAttendees,
  };
}

// ---------- check ----------------------------------------------------
//
// GET /api/bookings/check?facility_id=...&start_at=...&end_at=...&attendees=N
//
// Returns:
//   { conflict, mode, capacity, seats_taken, seats_remaining }
//
// `conflict` is preserved for the existing UI: true if this candidate
// booking can't fit. The richer fields let the UI show "5 of 12 seats
// taken" for shared facilities.

exports.check = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.query.facility_id);
  const startAt = req.query.start_at;
  const endAt   = req.query.end_at;
  const need = Math.max(1, intOrNull(req.query.attendees) || 1);

  if (!facilityId)        return fail(res, 'facility_id is required', 422);
  if (!startAt || !endAt) return fail(res, 'start_at and end_at are required (YYYY-MM-DD HH:MM:SS)', 422);
  if (startAt >= endAt)   return fail(res, 'end_at must be after start_at', 422);

  const facility = await loadFacility(facilityId);
  if (!facility || facility.trash) return fail(res, 'Facility not found', 404);
  if (req.user.role !== 'super_admin' && facility.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  const a = await checkAvailability(facility, startAt, endAt, need);
  return ok(res, {
    conflict: !a.ok,
    mode: a.mode,
    capacity: a.capacity,
    seats_taken: a.seatsTaken,
    seats_remaining: a.seatsRemaining,
    min_attendees: a.minAttendees || 1,
    reason: a.reason || null,
  });
});

// ---------- create ----------------------------------------------------

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  const facilityId = intOrNull(b.facility_id);
  const startAt = b.start_at;
  const endAt   = b.end_at;

  if (!facilityId)        return fail(res, 'facility_id is required', 422);
  if (!startAt || !endAt) return fail(res, 'start_at and end_at are required (YYYY-MM-DD HH:MM:SS)', 422);
  if (startAt >= endAt)   return fail(res, 'end_at must be after start_at', 422);
  if (b.repeat_type && !VALID_REPEAT.includes(b.repeat_type)) {
    return fail(res, 'repeat_type must be one of: ' + VALID_REPEAT.join(', '), 422);
  }

  const facility = await loadFacility(facilityId);
  if (!facility || facility.trash) return fail(res, 'Facility not found', 404);
  if (!facility.status)            return fail(res, 'Facility is inactive', 422);

  const booker = await loadBooker(req.user.id);
  if (!booker) return fail(res, 'Booker not found', 404);
  if (booker.tenant_id !== facility.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  const guests = Array.isArray(b.guests) ? b.guests.filter(
    (g) => g && (g.email || g.fname || g.lname || g.contact_no || g.contactNo)
  ) : [];
  const attendeeCount = 1 + guests.length;

  // Cheap UX guard - reject up front when the booker's own count alone
  // exceeds capacity. The real check happens inside the txn below.
  if (facility.capacity > 0 && attendeeCount > facility.capacity) {
    return fail(
      res,
      `This facility seats ${facility.capacity}. You are trying to book ${attendeeCount} (you + ${guests.length} guests).`,
      409
    );
  }

  // Pre-flight (outside txn) to give a friendly error fast when the slot
  // is obviously full. The post-INSERT check inside the txn is the real
  // race-safe verdict.
  const pre = await checkAvailability(facility, startAt, endAt, attendeeCount);
  if (!pre.ok) {
    if (pre.reason === 'BELOW_MIN') {
      return fail(res, `This slot needs at least ${pre.minAttendees} attendee(s) - you've only added ${attendeeCount}.`, 422);
    }
    if (pre.mode === 'exclusive') {
      return fail(res, 'That slot is already booked. Pick another time.', 409);
    }
    return fail(
      res,
      `Only ${pre.seatsRemaining} seat(s) left in that slot - your booking needs ${attendeeCount}.`,
      409
    );
  }

  const mealTimeIds = Array.isArray(b.meal_time_ids)
    ? b.meal_time_ids.map(intOrNull).filter((x) => x !== null)
    : [];

  // F06 - pantry orders. Body shape: [{ menu_item_id: 12, quantity: 2 }, ...]
  // Validation happens inside the txn (FK constraint plus an explicit check
  // that every menu_item_id belongs to a pantry linked to this facility).
  const pantryOrders = Array.isArray(b.pantry_orders)
    ? b.pantry_orders
        .map((o) => ({ menu_item_id: intOrNull(o && o.menu_item_id), quantity: Math.max(1, Number((o && o.quantity) || 1)) }))
        .filter((o) => o.menu_item_id !== null)
    : [];

  // department_id is always pulled from the booker, never trusted from the
  // client. Lets manager reports group "bookings per department" reliably.
  const departmentId = booker.department_id || null;

  let txResult;
  try {
    txResult = await withTransaction(async function (conn) {
      const [r] = await conn.execute(
        'INSERT INTO `bookings` ' +
        '   (tenant_id, facility_id, user_id, department_id, title, start_at, end_at, ' +
        '    repeat_type, status, remarks, dont_disturb, attendee_count) ' +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
        [
          booker.tenant_id, facilityId, booker.id, departmentId,
          b.title || null, startAt, endAt,
          b.repeat_type || 'none',
          b.remarks || null,
          b.dont_disturb ? 1 : 0,
          attendeeCount,
        ]
      );

      const bookingId = r.insertId;
      for (const g of guests) {
        await conn.execute(
          'INSERT INTO `booking_guests` (booking_id, fname, lname, contact_no, email) VALUES (?, ?, ?, ?, ?)',
          [bookingId, g.fname || null, g.lname || null, g.contact_no || g.contactNo || null, g.email || null]
        );
      }
      // F06 - validate pantry orders point to items in pantries linked to
      // this facility. Skip silently if not (defensive; UI should never send
      // these but a malicious client might).
      if (pantryOrders.length > 0) {
        const itemIds = pantryOrders.map((o) => o.menu_item_id);
        const placeholders = itemIds.map(() => '?').join(',');
        const [validRows] = await conn.execute(
          'SELECT mi.id FROM `pantry_menu_items` mi ' +
          ' INNER JOIN `facility_pantries` fp ON fp.pantry_id = mi.pantry_id ' +
          ' WHERE fp.facility_id = ? AND mi.id IN (' + placeholders + ')',
          [facilityId, ...itemIds]
        );
        const validSet = new Set(validRows.map((r) => r.id));
        for (const order of pantryOrders) {
          if (!validSet.has(order.menu_item_id)) continue;
          await conn.execute(
            'INSERT INTO `booking_pantry_orders` (booking_id, menu_item_id, quantity) VALUES (?, ?, ?)',
            [bookingId, order.menu_item_id, order.quantity]
          );
        }
      }

      for (const mid of mealTimeIds) {
        await conn.execute(
          'INSERT IGNORE INTO `booking_meals` (booking_id, meal_time_id) VALUES (?, ?)',
          [bookingId, mid]
        );
      }

      // Race-safe re-check INSIDE the same txn, with FOR SHARE gap locks.
      // The fresh row is included in this SUM (our own insert is visible
      // to us). Any concurrent insert into the same window either:
      //   - committed before us: its row shows up in the SUM and we roll back
      //   - is waiting: our FOR SHARE blocks it; we commit, it proceeds and
      //     hits the same wall
      const totalInWindow = await sumOverlapAttendees(
        (sql, params) => conn.execute(sql, params),
        facilityId, startAt, endAt,
        { forShare: true }
      );

      if (facility.shared_booking) {
        if (totalInWindow > facility.capacity) {
          // Custom marker so the outer catch can produce a clean 409.
          const e = new Error('CAPACITY_EXCEEDED');
          e._capacity = facility.capacity;
          e._totalInWindow = totalInWindow;
          throw e;
        }
      } else {
        // Exclusive: anyone else having ANY seat in this window means we
        // collided with a concurrent insert.
        if (totalInWindow > attendeeCount) {
          throw new Error('SLOT_TAKEN');
        }
      }

      // Materialize the per-facility approval chain.
      let stepsCreated = 0;
      let firstApprovalId = null;
      let firstApproverId = null;
      if (facility.requires_approval) {
        const m = await materializeChain({ conn, bookingId, facility, booker, stage: 'checkin' });
        stepsCreated = m.stepsCreated;
        firstApprovalId = m.firstApprovalId;
        firstApproverId = m.firstApproverId;
      }

      let finalStatus = 'pending';
      if (!facility.requires_approval || stepsCreated === 0) finalStatus = 'approved';
      if (finalStatus !== 'pending') {
        await conn.execute('UPDATE `bookings` SET status = ? WHERE id = ?', [finalStatus, bookingId]);
      }
      return { bookingId, status: finalStatus, firstApprovalId, firstApproverId };
    });
  } catch (e) {
    if (e && e.message === 'CAPACITY_EXCEEDED') {
      return fail(
        res,
        `Slot just filled up - another booking landed before yours. ` +
        `Only ${e._capacity - (e._totalInWindow - attendeeCount)} seat(s) free now. Pick another time.`,
        409
      );
    }
    if (e && e.message === 'SLOT_TAKEN') {
      return fail(res, 'That slot was just booked by someone else. Pick another time.', 409);
    }
    throw e;
  }

  if (txResult.firstApprovalId && txResult.firstApproverId) {
    console.log(
      `[bookings.create] booking #${txResult.bookingId} - kicking approval email to user #${txResult.firstApproverId} (step 1)`
    );
    (async () => {
      try {
        const token = await issueToken(txResult.firstApprovalId);
        await _sendApprovalEmailWithToken({
          approvalId: txResult.firstApprovalId,
          token,
        });
      } catch (e) {
        console.error('[bookings.create] first-step email failed:', e && e.message);
      }
    })();
  } else if (facility.requires_approval) {
    console.log(
      `[bookings.create] booking #${txResult.bookingId} - no approver could be resolved (auto-approved)`
    );
    // F07 - auto-approved path: still email the booker with reschedule/cancel links.
    (async () => {
      try { await _sendBookingConfirmedEmail(txResult.bookingId); }
      catch (e) { console.error('[bookings.create] confirm email failed:', e && e.message); }
    })();
  } else {
    console.log(
      `[bookings.create] booking #${txResult.bookingId} - facility does not require approval (auto-approved, sending confirm email)`
    );
    (async () => {
      try { await _sendBookingConfirmedEmail(txResult.bookingId); }
      catch (e) { console.error('[bookings.create] confirm email failed:', e && e.message); }
    })();
  }

  return created(
    res,
    { id: txResult.bookingId, status: txResult.status },
    txResult.status === 'approved' ? 'Booking confirmed' : 'Booking submitted for approval'
  );
});

// Shared helper - used by bookings.create + approvals.decide. Loads all the
// joined data the email template needs, then fires the templated email.
async function _sendApprovalEmailWithToken({ approvalId, token }) {
  const rows = await query(
    'SELECT ba.id, ba.booking_id, ba.step_order, ba.approver_user_id, ' +
    '       b.title, b.start_at, b.end_at, b.remarks, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.email AS approver_email, u.name AS approver_name, u.lname AS approver_lname, ' +
    '       bk.name AS booker_name, bk.lname AS booker_lname ' +
    '  FROM `booking_approvals` ba ' +
    '  INNER JOIN `bookings`   b  ON b.id  = ba.booking_id ' +
    '  INNER JOIN `facilities` f  ON f.id  = b.facility_id ' +
    '  INNER JOIN `users`      u  ON u.id  = ba.approver_user_id ' +
    '  INNER JOIN `users`      bk ON bk.id = b.user_id ' +
    ' WHERE ba.id = ? LIMIT 1',
    [approvalId]
  );
  if (rows.length === 0 || !rows[0].approver_email) return;
  const row = rows[0];

  const [totalRow, priorRows] = await Promise.all([
    query('SELECT COUNT(*) cnt FROM `booking_approvals` WHERE booking_id = ?', [row.booking_id]),
    query(
      'SELECT ba.step_order, ba.decision, ba.remark, ' +
      '       u.name AS approver_name, u.lname AS approver_lname ' +
      '  FROM `booking_approvals` ba ' +
      '  LEFT JOIN `users` u ON u.id = ba.approver_user_id ' +
      ' WHERE ba.booking_id = ? AND ba.step_order < ? ' +
      ' ORDER BY ba.step_order',
      [row.booking_id, row.step_order]
    ),
  ]);

  mailer.approvalRequested({
    to: row.approver_email,
    approverName: [row.approver_name, row.approver_lname].filter(Boolean).join(' ') || null,
    bookerName:  [row.booker_name,   row.booker_lname  ].filter(Boolean).join(' ') || null,
    facilityName: row.facility_name,
    facilityType: row.facility_type,
    startAt: typeof row.start_at === 'string' ? row.start_at : new Date(row.start_at).toISOString().replace('T',' ').slice(0,19),
    endAt:   typeof row.end_at   === 'string' ? row.end_at   : new Date(row.end_at  ).toISOString().replace('T',' ').slice(0,19),
    title: row.title,
    remarks: row.remarks,
    stepOrder: row.step_order,
    totalSteps: totalRow[0].cnt,
    priorDecisions: priorRows.map((d) => ({
      step_order: d.step_order,
      decision: d.decision,
      remark: d.remark,
      approver_name: [d.approver_name, d.approver_lname].filter(Boolean).join(' ') || null,
    })),
    token,
  });
}

exports._sendApprovalEmailWithToken = _sendApprovalEmailWithToken;

// ---------- list ------------------------------------------------------

exports.list = asyncHandler(async function (req, res) {
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['b.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('b.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('b.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  const isNonAdmin = req.user.role === 'employee' || req.user.role === 'approver';
  const scope = req.query.scope || (isNonAdmin ? 'mine' : 'tenant');
  if (scope === 'mine') { where.push('b.user_id = ?'); params.push(req.user.id); }
  if (scope === 'team') {
    where.push(
      'b.department_id IN (SELECT id FROM `departments` ' +
      ' WHERE manager_user_id = ? AND trash = 0)'
    );
    params.push(req.user.id);
  }

  if (req.query.status)      { where.push('b.status = ?');      params.push(req.query.status); }
  if (req.query.facility_id) { where.push('b.facility_id = ?'); params.push(intOrNull(req.query.facility_id)); }
  if (req.query.from_date)   { where.push('b.start_at >= ?');   params.push(req.query.from_date); }
  if (req.query.to_date)     { where.push('b.start_at < ?');    params.push(req.query.to_date); }

  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `bookings` b WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT b.id, b.tenant_id, b.facility_id, b.user_id, b.department_id, b.title, ' +
    '       b.start_at, b.end_at, b.repeat_type, b.status, b.remarks, b.dont_disturb, ' +
    '       b.attendee_count, b.created_at, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.name AS booker_name, u.lname AS booker_lname, u.username AS booker_username, ' +
    '       d.name AS department_name ' +
    '  FROM `bookings` b ' +
    '  LEFT JOIN `facilities`  f ON f.id = b.facility_id ' +
    '  LEFT JOIN `users`       u ON u.id = b.user_id ' +
    '  LEFT JOIN `departments` d ON d.id = b.department_id ' +
    ' WHERE ' + whereSql +
    ` ORDER BY b.start_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  // "Pending with" - first pending approval ordered by step_order.
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  if (pendingIds.length > 0) {
    const placeholders = pendingIds.map(() => '?').join(',');
    const pwRows = await query(
      'SELECT t.booking_id, t.approver_user_id, ' +
      '       u.name AS approver_name, u.lname AS approver_lname, u.email AS approver_email ' +
      '  FROM ( ' +
      '    SELECT ba.booking_id, ba.approver_user_id, ' +
      '           ROW_NUMBER() OVER (PARTITION BY ba.booking_id ORDER BY ba.step_order, ba.id) AS rn ' +
      '      FROM `booking_approvals` ba ' +
      "     WHERE ba.booking_id IN (" + placeholders + ") AND ba.decision = 'pending' " +
      '  ) t ' +
      '  LEFT JOIN `users` u ON u.id = t.approver_user_id ' +
      ' WHERE t.rn = 1',
      pendingIds
    );
    const byBooking = new Map();
    for (const r of pwRows) byBooking.set(r.booking_id, r);
    for (const r of rows) {
      const pw = byBooking.get(r.id);
      if (pw) {
        r.pending_with_user_id = pw.approver_user_id;
        r.pending_with_name = [pw.approver_name, pw.approver_lname].filter(Boolean).join(' ') || null;
        r.pending_with_email = pw.approver_email || null;
      } else {
        r.pending_with_user_id = null;
        r.pending_with_name = null;
        r.pending_with_email = null;
      }
    }
  }

  return ok(res, { data: rows, total, current_page: page, per_page: limit });
});

// ---------- getOne ----------------------------------------------------

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const scope = tenantScopeWhere(req, 'b');
  const rows = await query(
    'SELECT b.*, f.name AS facility_name, f.type AS facility_type, ' +
    '       u.name AS booker_name, u.lname AS booker_lname, ' +
    '       d.name AS department_name ' +
    '  FROM `bookings` b ' +
    '  LEFT JOIN `facilities`  f ON f.id = b.facility_id ' +
    '  LEFT JOIN `users`       u ON u.id = b.user_id ' +
    '  LEFT JOIN `departments` d ON d.id = b.department_id ' +
    ' WHERE b.id = ? AND b.trash = 0' + scope.sql +
    ' LIMIT 1',
    [id, ...scope.params]
  );
  if (rows.length === 0) return notFound(res, 'Booking not found');
  const booking = rows[0];

  const isNonAdmin = req.user.role === 'employee' || req.user.role === 'approver';
  if (isNonAdmin && booking.user_id !== req.user.id) {
    return fail(res, 'Forbidden', 403);
  }

  const [guests, meals, approvals] = await Promise.all([
    query('SELECT id, fname, lname, contact_no, email FROM `booking_guests` WHERE booking_id = ?', [id]),
    query(
      'SELECT m.id, m.name, m.start_time, m.end_time ' +
      '  FROM `booking_meals` bm ' +
      '  INNER JOIN `meal_times` m ON m.id = bm.meal_time_id ' +
      ' WHERE bm.booking_id = ? ORDER BY m.start_time',
      [id]
    ),
    query(
      'SELECT ba.id, ba.step_id, ba.step_order, ba.approver_user_id, ba.decision, ' +
      '       ba.remark, ba.decided_at, ' +
      '       u.name AS approver_name, u.lname AS approver_lname, u.username AS approver_username, ' +
      '       u.email AS approver_email, u.designation AS approver_designation ' +
      '  FROM `booking_approvals` ba ' +
      '  LEFT JOIN `users` u ON u.id = ba.approver_user_id ' +
      ' WHERE ba.booking_id = ? ' +
      ' ORDER BY ba.step_order, ba.id',
      [id]
    ),
  ]);

  return ok(res, { ...booking, guests, meals, approvals });
});

// ---------- cancel ----------------------------------------------------

exports.cancel = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const rows = await query(
    'SELECT id, tenant_id, user_id, status FROM `bookings` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return notFound(res, 'Booking not found');
  const booking = rows[0];

  if (req.user.role !== 'super_admin' && booking.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  const isNonAdmin = req.user.role === 'employee' || req.user.role === 'approver';
  if (isNonAdmin && booking.user_id !== req.user.id) {
    return fail(res, 'You can only cancel your own bookings', 403);
  }
  if (booking.status === 'cancelled' || booking.status === 'completed') {
    return fail(res, `Booking is already ${booking.status}`, 422);
  }

  await withTransaction(async function (conn) {
    await conn.execute("UPDATE `bookings` SET status = 'cancelled' WHERE id = ?", [id]);
    await conn.execute(
      "UPDATE `booking_approvals` SET decision = 'rejected', remark = 'Booking cancelled by booker', decided_at = NOW() " +
      " WHERE booking_id = ? AND decision = 'pending'",
      [id]
    );
  });

  return ok(res, null, 'Booking cancelled');
});

// ---------- F07: Reschedule / cancel via mail ----------------------------
//
// Helper: send the booking-confirmed email once a booking is approved.
// Issues two single-use tokens (one for reschedule, one for cancel) and
// embeds the deep-links. Called from both bookings.create (auto-approve
// path) and approvals.decide (final-step approve path).

async function _sendBookingConfirmedEmail(bookingId) {
  const rows = await query(
    'SELECT b.id, b.user_id, b.start_at, b.end_at, b.attendee_count, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.email AS booker_email, u.name AS booker_name, u.lname AS booker_lname ' +
    '  FROM `bookings`   b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    ' WHERE b.id = ? LIMIT 1',
    [bookingId]
  );
  if (rows.length === 0 || !rows[0].booker_email) return;
  const b = rows[0];

  const [rToken, cToken] = await Promise.all([
    bookingActionTokens.issueToken(bookingId, b.user_id, 'reschedule'),
    bookingActionTokens.issueToken(bookingId, b.user_id, 'cancel'),
  ]);

  mailer.bookingConfirmed({
    to: b.booker_email,
    bookerName: [b.booker_name, b.booker_lname].filter(Boolean).join(' ') || null,
    bookingId: b.id,
    facilityName: b.facility_name,
    facilityType: b.facility_type,
    startAt: typeof b.start_at === 'string' ? b.start_at : new Date(b.start_at).toISOString().replace('T', ' ').slice(0, 19),
    endAt:   typeof b.end_at   === 'string' ? b.end_at   : new Date(b.end_at  ).toISOString().replace('T', ' ').slice(0, 19),
    attendeeCount: b.attendee_count,
    rescheduleToken: rToken,
    cancelToken: cToken,
  });
}

exports._sendBookingConfirmedEmail = _sendBookingConfirmedEmail;

// GET /api/bookings/:id/act
// Consumes one of the booking_action_tokens. Login REQUIRED (the router
// already gates on authRequired); we verify req.user.id === token.user_id.
// Behaviour:
//   action=cancel      -> cancels the booking (same rules as exports.cancel)
//                         and returns { ok:true, action:'cancel' }.
//   action=reschedule  -> validates token and returns { ok:true, action:'reschedule' }.
//                         The frontend then renders the reschedule form
//                         and POSTs to /bookings/:id/reschedule.
exports.actByToken = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const rawToken = String(req.query.token || '').trim();
  const action = String(req.query.action || '').toLowerCase();
  if (!rawToken)                                          return fail(res, 'Missing token', 400);
  if (!['cancel', 'reschedule'].includes(action))         return fail(res, 'Invalid action', 400);

  const tokenRow = await bookingActionTokens.consumeToken(rawToken);
  if (!tokenRow || tokenRow.booking_id !== id || tokenRow.action !== action) {
    return fail(res, 'This link is invalid or has expired', 410);
  }
  if (tokenRow.user_id !== req.user.id && req.user.role !== 'super_admin') {
    return fail(res, 'This link belongs to a different account. Please sign in as the booker.', 403);
  }

  // Load booking and apply the same guards used elsewhere.
  const brows = await query(
    'SELECT id, tenant_id, user_id, status, start_at FROM `bookings` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (brows.length === 0) return notFound(res, 'Booking not found');
  const booking = brows[0];
  if (req.user.role !== 'super_admin' && booking.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  if (booking.status === 'cancelled' || booking.status === 'completed') {
    return fail(res, `Booking is already ${booking.status}`, 422);
  }
  if (new Date(booking.start_at) < new Date()) {
    return fail(res, 'This booking has already started or finished.', 422);
  }

  if (action === 'cancel') {
    await withTransaction(async function (conn) {
      await conn.execute("UPDATE `bookings` SET status = 'cancelled' WHERE id = ?", [id]);
      await conn.execute(
        "UPDATE `booking_approvals` SET decision = 'rejected', remark = 'Booking cancelled by booker (email link)', decided_at = NOW() " +
        " WHERE booking_id = ? AND decision = 'pending'",
        [id]
      );
    });
    await bookingActionTokens.markUsed(tokenRow.id);
    return ok(res, { id, action: 'cancel' }, 'Booking cancelled');
  }

  // action === 'reschedule' - we don't consume the token yet, the actual
  // reschedule happens via POST /bookings/:id/reschedule (which the
  // frontend pre-fills using the booking detail). Mark the link "viewed"
  // by issuing a short-lived session-style flag client-side; we still
  // require the same token on the POST so the link remains single-use.
  return ok(res, { id, action: 'reschedule', booking_id: id }, 'Token valid - render reschedule form');
});

// POST /api/bookings/:id/reschedule
// Body: { token, start_at, end_at }
// The token MUST be a booking_action_tokens row with action='reschedule'
// for this booking_id and this req.user.id (or super_admin override).
// Capacity & overlap checks run inside the same transaction.
exports.reschedule = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const body = req.body || {};
  const startAt = String(body.start_at || '').trim();
  const endAt   = String(body.end_at   || '').trim();
  const rawToken = String(body.token || '').trim();
  if (!startAt || !endAt) return fail(res, 'start_at and end_at are required', 422);
  if (!rawToken)          return fail(res, 'Missing token', 400);

  const tokenRow = await bookingActionTokens.consumeToken(rawToken);
  if (!tokenRow || tokenRow.booking_id !== id || tokenRow.action !== 'reschedule') {
    return fail(res, 'This link is invalid or has expired', 410);
  }
  if (tokenRow.user_id !== req.user.id && req.user.role !== 'super_admin') {
    return fail(res, 'This link belongs to a different account. Please sign in as the booker.', 403);
  }

  // Load booking + facility for capacity check
  const brows = await query(
    'SELECT b.id, b.tenant_id, b.facility_id, b.user_id, b.attendee_count, b.status, ' +
    '       f.shared_booking, f.capacity ' +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    ' WHERE b.id = ? AND b.trash = 0 LIMIT 1',
    [id]
  );
  if (brows.length === 0) return notFound(res, 'Booking not found');
  const booking = brows[0];
  if (req.user.role !== 'super_admin' && booking.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  if (!['pending', 'approved'].includes(booking.status)) {
    return fail(res, `Cannot reschedule a ${booking.status} booking`, 422);
  }
  if (new Date(startAt) >= new Date(endAt)) {
    return fail(res, 'End must be after start', 422);
  }
  if (new Date(startAt) < new Date()) {
    return fail(res, 'New start time must be in the future', 422);
  }

  // Capacity / overlap check in the same transaction.
  try {
    await withTransaction(async function (conn) {
      // Move the booking first.
      await conn.execute(
        'UPDATE `bookings` SET start_at = ?, end_at = ? WHERE id = ?',
        [startAt, endAt, id]
      );
      // Now SUM overlaps (excluding self) with FOR SHARE.
      const [overlapRows] = await conn.execute(
        "SELECT COALESCE(SUM(attendee_count), 0) AS total " +
        "  FROM `bookings` " +
        " WHERE facility_id = ? AND id <> ? AND status IN ('pending','approved','completed') " +
        "   AND start_at < ? AND end_at > ? FOR SHARE",
        [booking.facility_id, id, endAt, startAt]
      );
      const total = Number(overlapRows[0].total) + Number(booking.attendee_count);
      if (booking.shared_booking === 1) {
        if (total > Number(booking.capacity)) {
          const err = new Error('CAPACITY_EXCEEDED');
          err._capacity = booking.capacity;
          err._totalInWindow = total;
          throw err;
        }
      } else if (Number(overlapRows[0].total) > 0) {
        throw new Error('SLOT_TAKEN');
      }
    });
  } catch (e) {
    if (e && e.message === 'CAPACITY_EXCEEDED') {
      return fail(res, `Only ${e._capacity - (e._totalInWindow - Number(booking.attendee_count))} seat(s) free in that slot.`, 409);
    }
    if (e && e.message === 'SLOT_TAKEN') {
      return fail(res, 'That slot is already taken. Pick another time.', 409);
    }
    throw e;
  }

  await bookingActionTokens.markUsed(tokenRow.id);
  console.log(`[bookings.reschedule] booking #${id} moved to ${startAt} - ${endAt}`);
  return ok(res, { id, start_at: startAt, end_at: endAt }, 'Booking rescheduled');
});
//  (e && e.message === 'CAPACITY_EXCEEDED') {
//       return fail(res, `Only ${e._capacity - (e._totalInWindow - Number(booking.attendee_count))} seat(s) free in that slot.`, 409);
//     }
//     if (e && e.message === 'SLOT_TAKEN') {
//       return fail(res, 'That slot is already taken. Pick another time.', 409);
//     }
//     throw e;
//   }

//   await bookingActionTokens.markUsed(tokenRow.id);
//   console.log(`[bookings.reschedule] booking #${id} moved to ${startAt} - ${endAt}`);
//   return ok(res, { id, start_at: startAt, end_at: endAt }, 'Booking rescheduled');
// });
//     err._capacity = booking.capacity;
//           err._totalInWindow = total;
//           throw err;
//         }
//       } else if (Number(overlapRows[0].total) > 0) {
//         throw new Error('SLOT_TAKEN');
//       }
//     });
//   } catch (e) {
//     if (e && e.message === 'CAPACITY_EXCEEDED') {
//       return fail(res, `Only ${e._capacity - (e._totalInWindow - Number(booking.attendee_count))} seat(s) free in that slot.`, 409);
//     }
//     if (e && e.message === 'SLOT_TAKEN') {
//       return fail(res, 'That slot is already taken. Pick another time.', 409);
//     }
//     throw e;
//   }

//   await bookingActionTokens.markUsed(tokenRow.id);
//   console.log(`[bookings.reschedule] booking #${id} moved to ${startAt} - ${endAt}`);
//   return ok(res, { id, start_at: startAt, end_at: endAt }, 'Booking rescheduled');
// });
// n.execute(
//         'UPDATE `bookings` SET start_at = ?, end_at = ? WHERE id = ?',
//         [startAt, endAt, id]
//       );
//       const [overlapRows] = await conn.execute(
//         "SELECT COALESCE(SUM(attendee_count), 0) AS total " +
//         "  FROM `bookings` " +
//         " WHERE facility_id = ? AND id <> ? AND status IN ('pending','approved','completed') " +
//         "   AND start_at < ? AND end_at > ? FOR SHARE",
//         [booking.facility_id, id, endAt, startAt]
//       );
//       const total = Number(overlapRows[0].total) + Number(booking.attendee_count);
//       if (booking.shared_booking === 1) {
//         if (total > Number(booking.capacity)) {
//           const err = new Error('CAPACITY_EXCEEDED');
//           err._capacity = booking.capacity;
//           err._totalInWindow = total;
//           throw err;
//         }
//       } else if (Number(overlapRows[0].total) > 0) {
//         throw new Error('SLOT_TAKEN');
//       }
//     });
//   } catch (e) {
//     if (e && e.message === 'CAPACITY_EXCEEDED') {
//       return fail(res, `Only ${e._capacity - (e._totalInWindow - Number(booking.attendee_count))} seat(s) free in that slot.`, 409);
//     }
//     if (e && e.message === 'SLOT_TAKEN') {
//       return fail(res, 'That slot is already taken. Pick another time.', 409);
//     }
//     throw e;
//   }

//   await bookingActionTokens.markUsed(tokenRow.id);
//   console.log(`[bookings.reschedule] booking #${id} moved to ${startAt} - ${endAt}`);
//   return ok(res, { id, start_at: startAt, end_at: endAt }, 'Booking rescheduled');
// });
// _at: startAt, end_at: endAt }, 'Booking rescheduled');
// });
