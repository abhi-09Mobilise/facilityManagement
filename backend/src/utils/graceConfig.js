// graceConfig.js — the ONE owner of how the no-show grace period is resolved.
//
// Grace can be set at three scopes (migration 050). The effective value for a
// booking is the first non-NULL walking UP the hierarchy:
//
//   facility.grace_period_minutes
//     -> organisation.grace_period_minutes   (facility.site_id -> sites.organisation_id)
//       -> tenant.grace_period_minutes
//         -> env default (config.checkin.graceMin)
//
// Both the check-in window (public.controller) and the no-show sweeper resolve
// grace this way, so "too late to check in" and "released as no-show" always
// use the SAME number for a given booking.
//
// The resolution runs in SQL (COALESCE) against the DB clock, so it's immune to
// the Node process timezone — see checkinWindow.js for the same reasoning.

'use strict';

const config = require('../config');

/** Flat env fallback when no scope sets a value. */
function defaultGrace() {
  const n = Number(config.checkin && config.checkin.graceMin);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/**
 * SQL expression resolving effective grace minutes. Assumes the query joins
 * facilities + organisations + tenants under the given aliases.
 * @param {{f?:string,o?:string,t?:string}} aliases
 */
function graceSqlExpr({ f = 'f', o = 'o', t = 't' } = {}) {
  return `COALESCE(${f}.grace_period_minutes, ${o}.grace_period_minutes, ` +
         `${t}.grace_period_minutes, ${defaultGrace()})`;
}

/**
 * The LEFT JOINs that make graceSqlExpr resolvable. The caller's query must
 * already have `facilities f` (aliased as `f`) joined to the bookings row.
 * site -> organisation is LEFT (a facility's site may have no org set), and
 * tenant joins off the facility's tenant_id.
 * @param {{f?:string,s?:string,o?:string,t?:string}} aliases
 */
function graceJoins({ f = 'f', s = 's', o = 'o', t = 't' } = {}) {
  return (
    ` LEFT JOIN \`sites\`         ${s} ON ${s}.id = ${f}.site_id ` +
    ` LEFT JOIN \`organisations\` ${o} ON ${o}.id = ${s}.organisation_id ` +
    ` LEFT JOIN \`tenants\`       ${t} ON ${t}.id = ${f}.tenant_id `
  );
}

module.exports = { defaultGrace, graceSqlExpr, graceJoins };
