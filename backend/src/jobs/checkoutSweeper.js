// F02 - Check-out sweeper.
//
// Runs every CHECKOUT_SWEEP_MS milliseconds. For each booking that's:
//   - status='approved' AND
//   - checkout_status='not_started' AND
//   - end_at < NOW()
// it materializes the facility's CHECKOUT chain (if any exists) and emails
// the first checkout approver. If no checkout chain is configured for the
// facility, the booking's checkout_status is flipped straight to 'approved'
// (records-only path: nothing to wait on).

const { query, withTransaction } = require('../db/pool');
const { materializeChain } = require('../modules/bookings/chainMaterializer');
const { issueToken } = require('../utils/approvalActionTokens');
const bookingsCtrl = require('../modules/bookings/bookings.controller');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let timer = null;

async function sweepOnce() {
  // 1) Find candidate bookings.
  const candidates = await query(
    "SELECT id, facility_id, user_id, tenant_id " +
    "  FROM `bookings` " +
    " WHERE status = 'approved' " +
    "   AND checkout_status = 'not_started' " +
    "   AND end_at < NOW() " +
    "   AND trash = 0 " +
    " ORDER BY end_at ASC LIMIT 25"
  );
  if (candidates.length === 0) return { processed: 0 };

  let processed = 0;
  for (const c of candidates) {
    try {
      // Set status to 'pending' immediately so another sweeper sees it as in-flight.
      await query(
        "UPDATE `bookings` SET checkout_status = 'pending' " +
        " WHERE id = ? AND checkout_status = 'not_started'",
        [c.id]
      );

      // Load facility + booker (the materializer needs them).
      const facRows = await query(
        'SELECT id, tenant_id, site_id, name, type, capacity, requires_approval, shared_booking ' +
        '  FROM `facilities` WHERE id = ? LIMIT 1',
        [c.facility_id]
      );
      const bookerRows = await query(
        'SELECT id, tenant_id, department_id FROM `users` WHERE id = ? LIMIT 1',
        [c.user_id]
      );
      if (facRows.length === 0 || bookerRows.length === 0) continue;
      const facility = facRows[0];
      const booker = bookerRows[0];

      let firstApprovalId = null;
      let firstApproverId = null;
      let stepsCreated = 0;

      await withTransaction(async function (conn) {
        const m = await materializeChain({ conn, bookingId: c.id, facility, booker, stage: 'checkout' });
        firstApprovalId = m.firstApprovalId;
        firstApproverId = m.firstApproverId;
        stepsCreated = m.stepsCreated;
        // If no chain at all OR every step auto-approved, finalise immediately.
        if (m.stepsCreated === 0) {
          await conn.execute("UPDATE `bookings` SET checkout_status = 'approved' WHERE id = ?", [c.id]);
        }
      });

      // Fire first email outside the txn.
      if (firstApprovalId && firstApproverId) {
        try {
          const token = await issueToken(firstApprovalId);
          await bookingsCtrl._sendApprovalEmailWithToken({ approvalId: firstApprovalId, token });
        } catch (e) {
          console.error('[checkoutSweeper] first-step email failed:', e && e.message);
        }
      }
      console.log(
        `[checkoutSweeper] booking #${c.id} - checkout chain materialised (steps: ${stepsCreated})`
      );
      processed++;
    } catch (err) {
      console.error('[checkoutSweeper] booking #' + c.id + ' failed:', err && err.message);
    }
  }
  return { processed };
}

function start(intervalMs) {
  const ms = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    sweepOnce().catch((e) => console.error('[checkoutSweeper] sweep failed:', e && e.message));
  }, ms);
  // Don't keep the event loop alive on process exit.
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[checkoutSweeper] started (every ${Math.round(ms / 1000)}s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sweepOnce };
