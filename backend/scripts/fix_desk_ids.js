// T1.1 — One-time backfill: rewrite every chair id in
// `facilities.layout_json` from the legacy `C-NN` format to the stable,
// globally-unique `FAC<facilityId>-D<seq>` format, AND rewrite every
// `bookings.desk_id` that references those chairs to match.
//
// SAFETY (this script touches production data — read this before running):
//   1. Migration 046 must be applied first (adds `bookings.legacy_desk_id`).
//   2. Backup the DB before running in production (`mysqldump`).
//   3. Use --dry-run FIRST. It prints the exact rewrites without touching
//      the DB. Compare against expectations, then re-run without --dry-run.
//   4. --facility-id N rebuilds one facility only (recommended for staging
//      verification). Omit for a full-tenant run.
//   5. Every write happens INSIDE a per-facility transaction. If any step
//      fails, that facility rolls back — other facilities aren't affected.
//   6. `bookings.legacy_desk_id` receives the pre-rewrite `desk_id` value
//      so a rollback is a single UPDATE (see docstring at bottom).
//
// Usage:
//   node backend/scripts/fix_desk_ids.js --dry-run                (default: all facilities)
//   node backend/scripts/fix_desk_ids.js --facility-id 1432 --dry-run
//   node backend/scripts/fix_desk_ids.js --facility-id 1432
//   node backend/scripts/fix_desk_ids.js                          (all facilities, LIVE)
//
// Rollback (if bug discovered after a live run):
//   UPDATE bookings
//      SET desk_id = legacy_desk_id
//    WHERE legacy_desk_id IS NOT NULL;
//   -- and restore facilities.layout_json from your mysqldump backup.

const { pool, query } = require('../src/db/pool');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, facilityId: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--facility-id') out.facilityId = parseInt(args[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node backend/scripts/fix_desk_ids.js ' +
        '[--dry-run] [--facility-id N]'
      );
      process.exit(0);
    }
  }
  if (out.facilityId != null && !Number.isFinite(out.facilityId)) {
    throw new Error('--facility-id must be a positive integer');
  }
  return out;
}

/**
 * Given a legacy chair id (e.g. "C-05") and the stable-format target
 * prefix ("FAC1432"), return the new id ("FAC1432-D05"). Non-chair ids
 * (table_round, table_rect, wall, etc.) are returned unchanged.
 *
 * Idempotent: if the id is already in the stable format for THIS facility,
 * it's returned unchanged. Cross-facility renames (e.g. someone imported
 * a layout from facility 7 into facility 9) get rewritten to the new
 * facility's prefix so ids stay facility-scoped.
 */
function stableChairId(oldId, facilityId) {
  const raw = String(oldId || '');
  // Already correct prefix for this facility → keep as-is.
  const rightPrefix = new RegExp(`^FAC${facilityId}-D\\d+$`);
  if (rightPrefix.test(raw)) return raw;

  // Legacy C-NN format → extract the number.
  const legacy = /^C-(\d+)$/.exec(raw);
  if (legacy) {
    return `FAC${facilityId}-D${legacy[1].padStart(2, '0')}`;
  }
  // Stable format for a DIFFERENT facility (or `NEW-D` for an unsaved
  // layout) → re-namespace to this facility's prefix, preserving seq.
  const foreign = /-D(\d+)$/.exec(raw);
  if (foreign) {
    return `FAC${facilityId}-D${foreign[1].padStart(2, '0')}`;
  }
  // Unknown format — leave alone. The save-time validation (T1.1a) will
  // reject any conflicts. Better to log than to silently mangle.
  return raw;
}

/**
 * Rewrites one facility's layout_json + all matching bookings.desk_id.
 * Returns a summary. Does nothing if dryRun.
 */
async function fixFacility(facility, opts) {
  const summary = {
    facility_id: facility.id,
    chair_ids_rewritten: 0,
    table_labels_kept: 0,
    bookings_rewritten: 0,
    skipped_reason: null,
  };

  if (!facility.layout_json) {
    summary.skipped_reason = 'no layout_json';
    return summary;
  }

  let layout;
  try {
    layout = JSON.parse(facility.layout_json);
  } catch (err) {
    summary.skipped_reason = `layout_json parse failed: ${err.message}`;
    return summary;
  }

  const objs = (layout && Array.isArray(layout.objects)) ? layout.objects : [];
  if (objs.length === 0) {
    summary.skipped_reason = 'empty layout';
    return summary;
  }

  // Build the id-mapping table BEFORE we mutate anything.
  //   { oldChairId: newChairId, ... }
  const idMap = new Map();
  for (const o of objs) {
    if (!o || o.type !== 'chair' || !o.id) continue;
    const newId = stableChairId(o.id, facility.id);
    if (newId !== o.id) {
      idMap.set(String(o.id), newId);
    }
  }

  if (idMap.size === 0) {
    summary.skipped_reason = 'all chair ids already stable';
    return summary;
  }

  // Detect internal duplicates that would result from the rewrite.
  // (e.g. two chairs with "C-05" and "FAC1432-D05" already in the layout
  // — after rewriting the first, both would be "FAC1432-D05".)
  const resultSet = new Set();
  for (const o of objs) {
    if (!o || o.type !== 'chair' || !o.id) continue;
    const target = idMap.get(String(o.id)) || String(o.id);
    if (resultSet.has(target)) {
      summary.skipped_reason = `would produce duplicate chair id: ${target}. Fix manually.`;
      return summary;
    }
    resultSet.add(target);
  }

  // Build the rewritten layout.
  const newObjs = objs.map((o) => {
    if (!o || o.type !== 'chair' || !o.id) return o;
    const mapped = idMap.get(String(o.id));
    if (!mapped) return o;
    return { ...o, id: mapped, label: mapped };
  });
  const newLayoutJson = JSON.stringify({ ...layout, objects: newObjs });

  // Find active bookings that reference the OLD ids (comma-joined).
  // We rewrite each row's desk_id column by remapping every id in the
  // comma-joined list; ids not in the map (already stable, or unknown)
  // are kept as-is.
  const bookingRows = await query(
    'SELECT id, desk_id FROM `bookings` WHERE facility_id = ? AND trash = 0 AND desk_id IS NOT NULL',
    [facility.id]
  );

  const bookingUpdates = []; // { id, oldDeskId, newDeskId }
  for (const row of bookingRows) {
    const old = String(row.desk_id || '');
    const parts = old.split(',').map((s) => s.trim()).filter(Boolean);
    const remapped = parts.map((id) => idMap.get(id) || id);
    const nextDesk = remapped.join(',');
    if (nextDesk !== old) {
      bookingUpdates.push({ id: row.id, oldDeskId: old, newDeskId: nextDesk });
    }
  }

  summary.chair_ids_rewritten = idMap.size;
  summary.bookings_rewritten = bookingUpdates.length;

  if (opts.dryRun) {
    console.log(`[fix_desk_ids] DRY facility=${facility.id} name=${facility.name}`);
    for (const [oldId, newId] of idMap.entries()) {
      console.log(`  chair ${oldId} → ${newId}`);
    }
    for (const bu of bookingUpdates.slice(0, 5)) {
      console.log(`  booking #${bu.id} desk_id "${bu.oldDeskId}" → "${bu.newDeskId}"`);
    }
    if (bookingUpdates.length > 5) {
      console.log(`  ... and ${bookingUpdates.length - 5} more bookings`);
    }
    return summary;
  }

  // Live path — everything below in ONE transaction per facility.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Update layout_json.
    await conn.execute(
      'UPDATE `facilities` SET layout_json = ? WHERE id = ?',
      [newLayoutJson, facility.id]
    );
    // Update bookings — preserve OLD value into legacy_desk_id for
    // rollback, then rewrite desk_id. legacy_desk_id is not overwritten
    // if it's already set (protects against double-runs).
    for (const bu of bookingUpdates) {
      await conn.execute(
        'UPDATE `bookings` ' +
        '   SET legacy_desk_id = COALESCE(legacy_desk_id, ?), desk_id = ? ' +
        ' WHERE id = ?',
        [bu.oldDeskId, bu.newDeskId, bu.id]
      );
    }
    await conn.commit();
    console.log(
      `[fix_desk_ids] LIVE facility=${facility.id} ` +
      `chairs=${summary.chair_ids_rewritten} ` +
      `bookings=${summary.bookings_rewritten}`
    );
  } catch (err) {
    await conn.rollback();
    console.error(`[fix_desk_ids] facility=${facility.id} FAILED, rolled back: ${err.message}`);
    throw err;
  } finally {
    conn.release();
  }
  return summary;
}

async function main() {
  const opts = parseArgs();
  const target = opts.facilityId
    ? await query('SELECT id, name, layout_json FROM `facilities` WHERE id = ? AND trash = 0', [opts.facilityId])
    : await query('SELECT id, name, layout_json FROM `facilities` WHERE trash = 0 ORDER BY id ASC');

  console.log(
    `[fix_desk_ids] ${target.length} facilit${target.length === 1 ? 'y' : 'ies'} to inspect` +
    (opts.dryRun ? ' (DRY RUN)' : ' (LIVE)')
  );

  let totalChairs   = 0;
  let totalBookings = 0;
  let totalSkipped  = 0;
  let totalFailed   = 0;

  for (const f of target) {
    try {
      const s = await fixFacility(f, opts);
      totalChairs   += s.chair_ids_rewritten;
      totalBookings += s.bookings_rewritten;
      if (s.skipped_reason) {
        totalSkipped++;
        console.log(`[fix_desk_ids] facility=${f.id} SKIPPED: ${s.skipped_reason}`);
      }
    } catch (err) {
      totalFailed++;
      console.error(`[fix_desk_ids] facility=${f.id} ERROR: ${err && err.message}`);
    }
  }

  console.log(
    `[fix_desk_ids] DONE ` +
    `facilities_inspected=${target.length} ` +
    `chair_ids_rewritten=${totalChairs} ` +
    `bookings_rewritten=${totalBookings} ` +
    `skipped=${totalSkipped} ` +
    `failed=${totalFailed}`
  );

  await pool.end();
}

main().catch((err) => {
  console.error('[fix_desk_ids] fatal:', err && err.stack || err);
  process.exit(1);
});
