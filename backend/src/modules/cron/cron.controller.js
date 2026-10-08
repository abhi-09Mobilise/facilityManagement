// Cron-driven side jobs.
//
// These endpoints are designed to be hit by an external scheduler (OS
// cron, Vercel cron, GitHub Action, whatever). They DO NOT use the
// normal auth middleware — instead each request must carry a shared
// secret via ?key=<CRON_SECRET>. Without that secret the endpoint 401s.
//
// Today there are two jobs:
//   POST /api/cron/pre-end-notify         fires the per-facility "booking
//                                         ends in N min" mail to the
//                                         cleanup chain.
//   POST /api/cron/aggregate-occupancy    (T1.4) rebuilds yesterday's row
//                                         in `occupancy_daily` for every
//                                         facility. Idempotent — safe to
//                                         re-run for the same day.
//                                         Optional ?day=YYYY-MM-DD lets an
//                                         operator rebuild a specific past
//                                         day (used by the backfill script).
//
// Add new jobs alongside these (e.g. nightly digests, stale-token cleanup)
// rather than spinning up a separate scheduler service.

const { query, execute } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const mailer = require('../../utils/mailer');
const { resolveRecipients } = require('../bookings/chainMaterializer');
const occupancyAggregator = require('../../jobs/occupancyAggregator');
const noShowSweeper = require('../../jobs/noShowSweeper'); // M12

// Shared secret middleware. Reject without it so a casual external caller
// can't trigger N mails. The secret lives in .env (CRON_SECRET).
exports.requireCronKey = function (req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.warn('[cron] CRON_SECRET not set — endpoint disabled');
    return fail(res, 'Cron endpoints disabled (set CRON_SECRET in .env)', 503);
  }
  const key = req.query.key || req.get('x-cron-key');
  if (key !== expected) return fail(res, 'Forbidden', 401);
  return next();
};

// ----- pre-end-notify -------------------------------------------------
//
// Scans active bookings where:
//   - facility has pre_end_notify_minutes > 0
//   - booking has not been notified yet (pre_end_notified_at IS NULL)
//   - status is pending or approved (cancelled / rejected = skip)
//   - end_at - pre_end_notify_minutes <= NOW() < end_at
//                                 ^------ already inside the lead window
//                                          but not yet ended
//
// For each match we resolve the facility's cleanup chain (specific user +
// dynamic_dept_manager + dept members supported), fire the templated
// email, and stamp pre_end_notified_at so the next tick is a no-op.

exports.preEndNotify = asyncHandler(async function (req, res) {
  const startedAt = Date.now();

  // 1. Find due bookings. SQL handles the window math so we don't pull
  // hundreds of rows just to filter in JS.
  const due = await query(
    'SELECT b.id, b.tenant_id, b.facility_id, b.user_id, b.department_id, ' +
    '       b.title, b.start_at, b.end_at, b.attendee_count, ' +
    '       f.pre_end_notify_minutes, f.name AS facility_name, f.type AS facility_type, ' +
    '       u.name AS booker_name, u.lname AS booker_lname ' +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    " WHERE b.trash = 0 " +
    "   AND b.status IN ('pending','approved') " +
    '   AND b.pre_end_notified_at IS NULL ' +
    '   AND f.pre_end_notify_minutes IS NOT NULL ' +
    '   AND f.pre_end_notify_minutes > 0 ' +
    '   AND b.end_at > NOW() ' +
    '   AND DATE_SUB(b.end_at, INTERVAL f.pre_end_notify_minutes MINUTE) <= NOW() ' +
    ' ORDER BY b.end_at ASC ' +
    ' LIMIT 500'
  );

  if (due.length === 0) {
    return ok(res, { scanned: 0, notified: 0, elapsed_ms: Date.now() - startedAt });
  }

  // 2. For each due booking, resolve cleanup-chain recipients + send.
  // We need a real DB connection for the chain materialiser, so grab one
  // from the pool and hand it down.
  const pool = require('../../db/pool').pool;
  let notified = 0;
  let failures = 0;

  for (const b of due) {
    const facility = { id: b.facility_id, tenant_id: b.tenant_id };
    const booker   = { id: b.user_id, tenant_id: b.tenant_id, department_id: b.department_id };

    const bookerName = [b.booker_name, b.booker_lname].filter(Boolean).join(' ') || null;
    const startStr = typeof b.start_at === 'string' ? b.start_at : new Date(b.start_at).toISOString().replace('T', ' ').slice(0, 19);
    const endStr   = typeof b.end_at   === 'string' ? b.end_at   : new Date(b.end_at  ).toISOString().replace('T', ' ').slice(0, 19);

    let recipients = [];
    const conn = await pool.getConnection();
    try {
      recipients = await resolveRecipients({ conn, facility, booker, stage: 'cleanup' });
    } catch (e) {
      console.error('[cron.preEndNotify] resolveRecipients failed for booking #' + b.id + ':', e && e.message);
    } finally {
      conn.release();
    }

    if (recipients.length === 0) {
      // Nobody configured for cleanup chain — still mark the booking
      // notified so we don't keep scanning it every tick. If admin later
      // adds recipients, they apply to FUTURE bookings, not this one.
      await execute(
        'UPDATE `bookings` SET pre_end_notified_at = NOW() WHERE id = ?',
        [b.id]
      );
      continue;
    }

    for (const r of recipients) {
      try {
        mailer.bookingEndingSoon({
          to: r.email,
          recipientName: [r.name, r.lname].filter(Boolean).join(' ') || null,
          leadMinutes: b.pre_end_notify_minutes,
          facilityName: b.facility_name,
          facilityType: b.facility_type,
          startAt: startStr,
          endAt:   endStr,
          bookerName,
          attendeeCount: b.attendee_count,
          title: b.title,
        });
      } catch (e) {
        failures++;
        console.error('[cron.preEndNotify] send failed for booking #' + b.id + ' -> ' + r.email + ':', e && e.message);
      }
    }

    await execute(
      'UPDATE `bookings` SET pre_end_notified_at = NOW() WHERE id = ?',
      [b.id]
    );
    notified++;
  }

  const elapsed = Date.now() - startedAt;
  console.log(`[cron.preEndNotify] scanned=${due.length}  notified=${notified}  failures=${failures}  elapsed=${elapsed}ms`);
  return ok(res, { scanned: due.length, notified, failures, elapsed_ms: elapsed });
});


// ----- aggregate-occupancy (T1.4) -------------------------------------
//
// Rebuilds one day of the `occupancy_daily` rollup for every active
// facility. Default day = yesterday. An operator can pass ?day=YYYY-MM-DD
// to rebuild a specific historical day (e.g. after fixing a bug in the
// aggregation SQL).
//
// The aggregator's own SQL uses INSERT ... ON DUPLICATE KEY UPDATE keyed
// on (day, facility_id, department_id), so this endpoint is fully
// idempotent — running it 10 times for the same day produces the same
// result as running it once.
//
// External scheduler cadence: run once nightly (recommended 02:00 server
// time). If a run is missed, the next night's run only covers ITS
// yesterday, so the missed day stays stale. To catch up, the operator
// posts to this endpoint with ?day=<missed-date>. The 90-day backfill
// script (T1.5) uses the same mechanism.
exports.aggregateOccupancy = asyncHandler(async function (req, res) {
  const startedAt = Date.now();
  const dayParam = String(req.query.day || '').trim();
  const day = dayParam || null;   // null → aggregator picks yesterday

  const summary = day
    ? await occupancyAggregator.aggregateDay(day)
    : await occupancyAggregator.aggregateYesterday();

  const elapsed = Date.now() - startedAt;
  console.log(
    `[cron.aggregateOccupancy] day=${summary.day} ` +
    `facilities=${summary.facilities_processed} ` +
    `rows_upserted=${summary.rows_upserted} ` +
    `failures=${summary.failures} elapsed=${elapsed}ms`
  );
  return ok(res, { ...summary, elapsed_ms: elapsed });
});


// ----- release-no-shows (M12) -----------------------------------------
//
// Releases approved bookings whose check-in grace window closed with nobody
// checked in, freeing the seat for the rest of the slot. Idempotent: a second
// call finds no new candidates. Honours NO_SHOW_SWEEP_MODE=log for a dry run.
//
// The in-process interval sweeper (jobs/noShowSweeper, started in server.js)
// already runs this every few minutes; this endpoint lets an external
// scheduler drive it instead / as well, matching the other cron jobs.
exports.releaseNoShows = asyncHandler(async function (req, res) {
  const startedAt = Date.now();
  const summary = await noShowSweeper.sweepOnce();
  const elapsed = Date.now() - startedAt;
  console.log(
    `[cron.releaseNoShows] mode=${summary.mode} grace=${summary.grace_min}m ` +
    `candidates=${summary.candidates} released=${summary.released} elapsed=${elapsed}ms`
  );
  return ok(res, { ...summary, elapsed_ms: elapsed });
});
