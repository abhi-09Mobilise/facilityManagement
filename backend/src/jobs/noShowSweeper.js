// M12 - No-show auto-release sweeper.
//
// Runs every NO_SHOW_SWEEP_MS ms (default 5 min). Releases bookings whose
// check-in grace window has closed with nobody checked in, so the seat frees
// up for the rest of the slot.
//
// A booking is a no-show when ALL of:
//   - status = 'approved'              (confirmed, so it actually holds a seat)
//   - checked_in_at IS NULL            (nobody scanned in)
//   - NOW() > start_at + graceMin      (the /checkin window has fully closed)
//   - NOW() < end_at                   (the booking is STILL LIVE — see below)
//
// graceMin is the SAME config.checkin.graceMin used by POST /public/checkin,
// so there is never a gap between "too late to check in" and "released".
//
// Why `NOW() < end_at`:
//   Releasing only frees a seat while the booking window is still open. More
//   importantly, without this bound the FIRST run after deploy would sweep up
//   every historical pre-check-in booking (all of which have checked_in_at
//   NULL and are long past start+grace) and rewrite their status. Bounding to
//   live bookings keeps history intact and matches the intent: free the seat
//   now, don't retroactively re-label the past.
//
// Modes (NO_SHOW_SWEEP_MODE env):
//   'enforce' (default) - flip status to 'released'
//   'log'               - dry run; log what WOULD be released, change nothing
//
// Seat availability is derived from bookings (no per-seat status column), and
// every availability/capacity query whitelists status IN
// ('pending','approved','completed'). 'released' is excluded, so the desk and
// the shared-capacity SUM free automatically with no other code changes.

const { query, execute } = require('../db/pool');
const config = require('../config');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let timer = null;

function graceMin() {
  const n = Number(config.checkin && config.checkin.graceMin);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

function mode() {
  return String(process.env.NO_SHOW_SWEEP_MODE || 'enforce').toLowerCase() === 'log'
    ? 'log' : 'enforce';
}

async function sweepOnce() {
  const g = graceMin();
  const m = mode();

  // Window math in SQL (NOW() vs start_at/end_at) so it's immune to the Node
  // process timezone — same reasoning as checkinWindow.js. g is a trusted
  // integer from config, safe to inline.
  const candidates = await query(
    "SELECT id, facility_id, start_at, end_at " +
    "  FROM `bookings` " +
    " WHERE status = 'approved' " +
    "   AND checked_in_at IS NULL " +
    "   AND trash = 0 " +
    "   AND NOW() > start_at + INTERVAL " + g + " MINUTE " +
    "   AND NOW() < end_at " +
    " ORDER BY start_at ASC LIMIT 200"
  );
  if (candidates.length === 0) return { mode: m, grace_min: g, candidates: 0, released: 0 };

  if (m === 'log') {
    for (const c of candidates) {
      console.log(
        `[noShowSweeper] (log) would release booking #${c.id} ` +
        `facility=${c.facility_id} start=${c.start_at}`
      );
    }
    return { mode: m, grace_min: g, candidates: candidates.length, released: 0 };
  }

  let released = 0;
  for (const c of candidates) {
    try {
      // Race-safe: only flip if STILL approved and not checked in. A check-in
      // that lands in the same tick wins (affectedRows = 0) and we skip.
      const r = await execute(
        "UPDATE `bookings` SET status = 'released' " +
        " WHERE id = ? AND status = 'approved' AND checked_in_at IS NULL",
        [c.id]
      );
      if (r.affectedRows === 1) {
        released += 1;
        console.log(
          `[noShowSweeper] released no-show booking #${c.id} ` +
          `facility=${c.facility_id} start=${c.start_at}`
        );
      }
    } catch (err) {
      console.error('[noShowSweeper] booking #' + c.id + ' failed:', err && err.message);
    }
  }
  return { mode: m, grace_min: g, candidates: candidates.length, released };
}

function start(intervalMs) {
  const ms = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    sweepOnce().catch((e) => console.error('[noShowSweeper] sweep failed:', e && e.message));
  }, ms);
  // Don't keep the event loop alive on process exit.
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[noShowSweeper] started (every ${Math.round(ms / 1000)}s, mode=${mode()}, grace=${graceMin()}m)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sweepOnce };
