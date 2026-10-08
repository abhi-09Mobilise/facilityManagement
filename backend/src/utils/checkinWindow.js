// checkinWindow.js — the ONE owner of the check-in window rule.
//
// Window: [ start_at − opensMin , start_at + graceMin ]
//   opensMin  how early you may check in before your booking starts
//   graceMin  how late you may still check in after start before it's a no-show
//
// IMPORTANT — the authoritative check runs in SQL against the DATABASE clock
// (NOW()), NOT the Node process clock. `bookings.start_at` is a naive DATETIME
// (no timezone), and the pool reads it back as a bare string ("2026-10-07
// 09:00:00"). If we did `new Date(thatString)` in Node, V8 would parse it in
// the Node PROCESS timezone — so a server running in UTC while bookings are
// entered in IST would shift the whole window by the UTC offset and reject
// valid check-ins ("too early" / "too late"). Comparing start_at against NOW()
// inside MySQL keeps both operands in the same frame, so the window is correct
// regardless of where/how the Node process is configured.
//
// Grace is a flat per-tenant constant for now (env-tunable via config.checkin).
// When per-facility grace-config (M3) lands, swap these two numbers for the
// facility columns — callers don't change.

'use strict';

const config = require('../config');

// opensMin/graceMin come from config (parseInt of env) — coerce to a clean
// integer so they are safe to inline into SQL (never user input).
function mins(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

/**
 * Build the SELECT columns that classify the window for a booking row, plus a
 * NOW() echo for debugging. Inline the (trusted, integer) minute values so the
 * caller's param list stays just its own params.
 *
 * @param {string} startExpr  SQL expression for the booking start (e.g. 'b.start_at')
 * @returns {{ columns: string }}
 */
function windowColumns(startExpr = 'b.start_at') {
  const o = mins(config.checkin && config.checkin.opensMin, 15);
  const g = mins(config.checkin && config.checkin.graceMin, 30);
  return {
    columns:
      `NOW() AS server_now, ` +
      `DATE_FORMAT(${startExpr} - INTERVAL ${o} MINUTE, '%H:%i') AS opens_at, ` +
      `DATE_FORMAT(${startExpr} + INTERVAL ${g} MINUTE, '%H:%i') AS closes_at, ` +
      `(NOW() < ${startExpr} - INTERVAL ${o} MINUTE) AS too_early, ` +
      `(NOW() > ${startExpr} + INTERVAL ${g} MINUTE) AS too_late`,
  };
}

module.exports = { windowColumns, opensMin: () => mins(config.checkin && config.checkin.opensMin, 15) };
