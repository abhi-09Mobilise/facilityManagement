// F01 - per-facility slot capacity overrides.
//
// Endpoints (mounted under /api/facilities/:id/slot-capacities):
//   GET  / -> list overrides for this facility
//   PUT  / -> replace-all overrides for this facility
//
// effectiveCapacity(facilityId, startAt, endAt) is the helper bookings
// uses at create/reschedule time. It returns:
//   { max, min, matched } - matched is true if an override was found.
// If no override matches, callers fall back to facilities.capacity.

const { query, withTransaction } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');

async function ownsFacility(req, facilityId) {
  const rows = await query(
    'SELECT id, tenant_id FROM `facilities` WHERE id = ? LIMIT 1', [facilityId]
  );
  if (rows.length === 0) return false;
  if (req.user.role === 'super_admin') return true;
  return rows[0].tenant_id === req.user.tenant_id;
}

exports.list = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.params.id);
  if (facilityId === null) return fail(res, 'Invalid facility id', 400);
  if (!(await ownsFacility(req, facilityId))) return fail(res, 'Forbidden', 403);

  const rows = await query(
    'SELECT id, facility_id, day_of_week, ' +
    "       TIME_FORMAT(start_time, '%H:%i') AS start_time, " +
    "       TIME_FORMAT(end_time,   '%H:%i') AS end_time, " +
    '       min_attendees, max_attendees, status ' +
    '  FROM `facility_slot_overrides` ' +
    ' WHERE facility_id = ? ' +
    ' ORDER BY day_of_week, start_time',
    [facilityId]
  );
  return ok(res, rows);
});

// Replace-all. Body: { overrides: [ { day_of_week, start_time, end_time, min_attendees, max_attendees, status? } ] }
exports.replace = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.params.id);
  if (facilityId === null) return fail(res, 'Invalid facility id', 400);
  if (!(await ownsFacility(req, facilityId))) return fail(res, 'Forbidden', 403);

  const body = req.body || {};
  const overrides = Array.isArray(body.overrides) ? body.overrides : [];

  // Normalise + validate
  const clean = [];
  for (const raw of overrides) {
    const dow = Number(raw.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return fail(res, 'day_of_week must be 0..6 (Sun..Sat)', 422);
    }
    const start = String(raw.start_time || '').trim();
    const end   = String(raw.end_time   || '').trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start) || !/^\d{2}:\d{2}(:\d{2})?$/.test(end)) {
      return fail(res, 'start_time and end_time must be HH:MM or HH:MM:SS', 422);
    }
    if (start >= end) return fail(res, 'end_time must be after start_time', 422);
    const minA = Math.max(1, Number(raw.min_attendees || 1));
    const maxA = Number(raw.max_attendees);
    if (!Number.isInteger(maxA) || maxA < minA) {
      return fail(res, 'max_attendees must be >= min_attendees', 422);
    }
    clean.push({
      day_of_week: dow,
      start_time: start.length === 5 ? start + ':00' : start,
      end_time:   end.length   === 5 ? end   + ':00' : end,
      min_attendees: minA,
      max_attendees: maxA,
      status: raw.status === 0 ? 0 : 1,
    });
  }

  // Overlap check per day (half-open intervals [start, end))
  const byDay = {};
  for (const c of clean) (byDay[c.day_of_week] = byDay[c.day_of_week] || []).push(c);
  for (const dow of Object.keys(byDay)) {
    const list = byDay[dow].slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < list.length; i++) {
      if (list[i].start_time < list[i - 1].end_time) {
        return fail(res, 'Slot overrides on the same day must not overlap.', 422);
      }
    }
  }

  await withTransaction(async function (conn) {
    await conn.execute('DELETE FROM `facility_slot_overrides` WHERE facility_id = ?', [facilityId]);
    for (const c of clean) {
      await conn.execute(
        'INSERT INTO `facility_slot_overrides` ' +
        '(facility_id, day_of_week, start_time, end_time, min_attendees, max_attendees, status) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [facilityId, c.day_of_week, c.start_time, c.end_time, c.min_attendees, c.max_attendees, c.status]
      );
    }
  });

  console.log(`[facilities.slot-capacities] facility #${facilityId} replaced with ${clean.length} override(s)`);
  return ok(res, { count: clean.length }, 'Slot capacities updated');
});

// Helper used by bookings.create / bookings.reschedule. Resolves the
// effective {max,min,matched} for one window. Currently looks at the start
// timestamp's day-of-week and the start TIME, and requires the override to
// fully contain the booking window on that same day. Bookings that span
// midnight don't get an override match (we fall back to facilities.capacity).
//
// `mysqlInstantTs` is the `start_at`/`end_at` string we store (YYYY-MM-DD HH:MM:SS).
exports.effectiveCapacity = async function effectiveCapacity(facilityId, startAt, endAt) {
  // Local date arithmetic - everything is server-local already (no TZ math).
  const startDate = new Date(String(startAt).replace(' ', 'T'));
  const endDate   = new Date(String(endAt).replace(' ', 'T'));
  if (isNaN(startDate) || isNaN(endDate)) return { matched: false };

  // JS getDay: 0=Sun..6=Sat - matches our day_of_week schema.
  const dow = startDate.getDay();
  const startTime = String(startAt).slice(11, 19);
  const endTime   = String(endAt).slice(11, 19);

  // Only attempt match when start + end fall on the same day.
  const sameDay = String(startAt).slice(0, 10) === String(endAt).slice(0, 10);
  if (!sameDay) return { matched: false };

  const rows = await query(
    'SELECT min_attendees, max_attendees ' +
    '  FROM `facility_slot_overrides` ' +
    ' WHERE facility_id = ? AND day_of_week = ? AND status = 1 ' +
    '   AND start_time <= ? AND end_time >= ? LIMIT 1',
    [facilityId, dow, startTime, endTime]
  );
  if (rows.length === 0) return { matched: false };
  return { matched: true, min: Number(rows[0].min_attendees), max: Number(rows[0].max_attendees) };
};
