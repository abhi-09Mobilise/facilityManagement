// T1.5 - One-time backfill of `occupancy_daily` for the last N days.
//
// The nightly aggregator (jobs/occupancyAggregator.js + POST
// /api/cron/aggregate-occupancy) only writes YESTERDAY's row. For
// dashboards to show trends from day one, we need history — this script
// walks backwards from today and re-uses the same aggregator on each day.
//
// Usage:
//     node backend/scripts/backfill_occupancy.js               → last 90 days
//     node backend/scripts/backfill_occupancy.js --days 30     → last 30 days
//     node backend/scripts/backfill_occupancy.js --from 2026-06-01 --to 2026-09-14
//     node backend/scripts/backfill_occupancy.js --dry-run     → count only
//
// Safety:
//   - Uses the SAME idempotent INSERT ... ON DUPLICATE KEY UPDATE path
//     as the nightly aggregator. Re-running the backfill for the same
//     range produces identical results.
//   - Never writes to `bookings` or any other production table.
//   - Sequential per-day to keep DB load predictable. A day for a
//     mid-sized tenant (100 facilities, 10k bookings/day) takes ~2-3
//     seconds. 90 days ≈ 5 minutes.
//   - Progress is printed per day so a long run stays observable.

const aggregator = require('../src/jobs/occupancyAggregator');
const { pool } = require('../src/db/pool');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { days: 90, from: null, to: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--days')     { out.days   = parseInt(args[++i], 10); }
    else if (a === '--from') { out.from  = args[++i]; }
    else if (a === '--to')   { out.to    = args[++i]; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/backfill_occupancy.js ' +
        '[--days N] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]'
      );
      process.exit(0);
    }
  }
  return out;
}

function isoDayStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build the ordered day list. Preference:
 *   1) explicit --from + --to
 *   2) --days N ending yesterday
 * Returns an array of 'YYYY-MM-DD' strings, oldest first.
 */
function buildDayList({ from, to, days }) {
  const list = [];
  if (from && to) {
    const start = new Date(from + 'T00:00:00');
    const end   = new Date(to + 'T00:00:00');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error(`invalid --from / --to. Use YYYY-MM-DD.`);
    }
    if (start > end) throw new Error('--from is after --to');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      list.push(isoDayStr(d));
    }
    return list;
  }

  // days-back mode. End is YESTERDAY (today's aggregation is the
  // nightly job's responsibility; the backfill doesn't touch today).
  const nDays = Math.max(1, Number(days) || 90);
  const end = new Date();
  end.setDate(end.getDate() - 1);   // yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - (nDays - 1));
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    list.push(isoDayStr(d));
  }
  return list;
}

async function main() {
  const opts = parseArgs();
  const days = buildDayList(opts);

  console.log(
    `[backfill_occupancy] ${days.length} day(s) from ${days[0]} to ${days[days.length - 1]}` +
    (opts.dryRun ? ' (DRY RUN)' : '')
  );

  if (opts.dryRun) {
    console.log('[backfill_occupancy] DRY RUN — no writes. Exiting.');
    await pool.end();
    return;
  }

  const t0 = Date.now();
  let totalFacilities = 0;
  let totalRows       = 0;
  let totalFailures   = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const startedAt = Date.now();
    try {
      const s = await aggregator.aggregateDay(day);
      totalFacilities += s.facilities_processed;
      totalRows       += s.rows_upserted;
      totalFailures   += s.failures;
      const dur = Date.now() - startedAt;
      console.log(
        `[backfill_occupancy] ${i + 1}/${days.length}  day=${day}  ` +
        `facilities=${s.facilities_processed}  rows=${s.rows_upserted}  ` +
        `failures=${s.failures}  elapsed=${dur}ms`
      );
    } catch (err) {
      totalFailures++;
      console.error(
        `[backfill_occupancy] ${i + 1}/${days.length}  day=${day}  ` +
        `FAILED: ${err && err.message}`
      );
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[backfill_occupancy] DONE  days=${days.length}  ` +
    `facility-day slices=${totalFacilities}  ` +
    `rows_upserted=${totalRows}  failures=${totalFailures}  ` +
    `elapsed=${(elapsed / 1000).toFixed(1)}s`
  );

  await pool.end();
}

main().catch((err) => {
  console.error('[backfill_occupancy] fatal:', err && err.stack || err);
  process.exit(1);
});
