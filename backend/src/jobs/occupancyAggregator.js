// T1.4 (M6) - Occupancy aggregator.
//
// Rebuilds the `occupancy_daily` rollup for a given day. The default entry
// point is `aggregateYesterday()` — called nightly by an external scheduler
// via POST /api/cron/aggregate-occupancy (see cron.controller.js).
//
// Design principles:
//   - IDEMPOTENT: safe to re-run for the same day. Uses INSERT ... ON
//     DUPLICATE KEY UPDATE keyed on (day, facility_id, department_id).
//     No partial state between runs — every row is recomputed from
//     scratch.
//   - INCREMENTAL by day: aggregates ONE day at a time. Backfills iterate.
//   - RESILIENT: per-facility try/catch. A single bad facility never
//     blocks the rest of the run.
//   - MYSQL-DRIVEN: measures are computed by SQL in a single query per
//     facility (not by pulling every booking into JS). Keeps the job
//     fast even at millions of bookings.
//
// Not persisted anywhere else in the process — memory footprint of a run
// is bounded by (facilities on tenant) * (aggregator loop overhead). No
// caching, no queues, no external side-effects beyond the DB write.

const { query, execute } = require('../db/pool');

/**
 * Format a JS Date into 'YYYY-MM-DD' (local time / server time). MySQL
 * DATE columns accept this shape directly and it round-trips cleanly.
 */
function toDayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute yesterday's day string in server time.
 */
function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDayString(d);
}

/**
 * Aggregate a single day for a single facility. Returns a count of rows
 * upserted (0 if the facility has no bookings + no department slices;
 * we still write ONE row with zeros so the presence signal is there).
 *
 * The SQL below computes all measures in one pass by joining bookings
 * with a departments cross-slice. Nullable department_id is normalised
 * to 0 (denormalisation sentinel; see migration 047 for reasoning).
 */
async function aggregateFacilityDay(day, facility) {
  const rows = await query(
    // MySQL date-range trick: [day 00:00, next-day 00:00). We SELECT one
    // aggregated row per (facility, department) — the aggregator only
    // sees this facility, so grouping is by department. Measures use
    // conditional aggregation.
    //
    // booked_minutes: SUM of the overlap between each booking window and
    // the day's window [day 00:00, day+1 00:00). Clipped in SQL via LEAST
    // and GREATEST.
    //
    // day_start = ?  (bound param 2)
    // day_end   = ?  (bound param 3, day+1 midnight)
    // facility_id = ? (bound param 1)
    "SELECT " +
    "  COALESCE(b.department_id, 0) AS department_id, " +
    "  SUM(CASE WHEN b.status IN ('pending','approved','completed') THEN 1 ELSE 0 END) AS bookings_count, " +
    "  SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS released_count, " +
    "  SUM(CASE WHEN b.status IN ('approved','completed') " +
    "            AND b.checkout_status = 'approved' THEN 1 ELSE 0 END) AS checked_in_count, " +
    "  SUM(CASE WHEN b.status IN ('pending','approved','completed') THEN " +
    "        GREATEST(0, " +
    "          TIMESTAMPDIFF(MINUTE, " +
    "            GREATEST(b.start_at, ?), " +   // param 2: day_start
    "            LEAST(b.end_at, ?) " +          // param 3: day_end
    "          ) " +
    "        ) " +
    "      ELSE 0 END) AS booked_minutes " +
    "  FROM `bookings` b " +
    " WHERE b.facility_id = ? " +                // param 1: facility_id
    "   AND b.trash = 0 " +
    "   AND b.end_at > ? " +                     // param 4: day_start
    "   AND b.start_at < ? " +                   // param 5: day_end
    " GROUP BY COALESCE(b.department_id, 0)",
    [
      `${day} 00:00:00`,
      `${day} 23:59:59`,
      facility.id,
      `${day} 00:00:00`,
      `${day} 23:59:59`,
    ]
  );

  // Compute the day's total-capacity-minutes ceiling used by open_minutes:
  //   (capacity - offline_capacity) * 24 * 60, floored at 0.
  // Open minutes = ceiling - booked_minutes, floored at 0.
  const capacityOnline = Math.max(0, (facility.capacity || 0) - (facility.offline_capacity || 0));
  const dayCeilingMinutes = capacityOnline * 24 * 60;

  // If the facility has zero bookings for the day, we still write ONE
  // "empty" row (with department_id=0) so downstream queries have a
  // presence marker rather than a hole.
  const upserts = rows.length > 0 ? rows : [{
    department_id:   0,
    bookings_count:  0,
    released_count:  0,
    checked_in_count: 0,
    booked_minutes:  0,
  }];

  let n = 0;
  for (const r of upserts) {
    const bookingsCount   = Number(r.bookings_count)   || 0;
    const releasedCount   = Number(r.released_count)   || 0;
    const checkedInCount  = Number(r.checked_in_count) || 0;
    const bookedMinutes   = Math.min(Number(r.booked_minutes) || 0, dayCeilingMinutes);
    const openMinutes     = Math.max(0, dayCeilingMinutes - bookedMinutes);

    await execute(
      'INSERT INTO `occupancy_daily` ' +
      '  (day, tenant_id, site_id, building_id, floor_id, facility_id, department_id, ' +
      '   bookings_count, released_count, checked_in_count, booked_minutes, open_minutes) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE ' +
      '  site_id           = VALUES(site_id), ' +
      '  building_id       = VALUES(building_id), ' +
      '  floor_id          = VALUES(floor_id), ' +
      '  bookings_count    = VALUES(bookings_count), ' +
      '  released_count    = VALUES(released_count), ' +
      '  checked_in_count  = VALUES(checked_in_count), ' +
      '  booked_minutes    = VALUES(booked_minutes), ' +
      '  open_minutes      = VALUES(open_minutes)',
      [
        day,
        facility.tenant_id,
        facility.site_id,
        facility.building_id,
        facility.floor_id,
        facility.id,
        Number(r.department_id) || 0,
        bookingsCount,
        releasedCount,
        checkedInCount,
        bookedMinutes,
        openMinutes,
      ]
    );
    n++;
  }
  return n;
}

/**
 * Aggregate all active facilities for a given day. Returns
 *   { day, facilities_processed, rows_upserted, failures }.
 */
async function aggregateDay(day) {
  const facilities = await query(
    'SELECT f.id, f.tenant_id, f.site_id, f.floor_id, f.capacity, f.offline_capacity, ' +
    '       flr.building_id ' +
    '  FROM `facilities` f ' +
    '  LEFT JOIN `floors` flr ON flr.id = f.floor_id ' +
    ' WHERE f.trash = 0 ' +
    ' ORDER BY f.id ASC'
  );

  let facilitiesProcessed = 0;
  let rowsUpserted        = 0;
  let failures            = 0;

  for (const f of facilities) {
    try {
      const n = await aggregateFacilityDay(day, f);
      rowsUpserted += n;
      facilitiesProcessed++;
    } catch (err) {
      failures++;
      console.error(
        `[occupancyAggregator] facility #${f.id} day=${day} failed: ${err && err.message}`
      );
    }
  }

  return {
    day,
    facilities_processed: facilitiesProcessed,
    rows_upserted: rowsUpserted,
    failures,
  };
}

/**
 * Convenience: aggregate yesterday. Called by the nightly cron endpoint.
 */
async function aggregateYesterday() {
  return aggregateDay(yesterdayString());
}

module.exports = {
  aggregateDay,
  aggregateYesterday,
  aggregateFacilityDay, // exported so scripts/backfill_occupancy.js can iterate
  toDayString,          // shared helper
};
