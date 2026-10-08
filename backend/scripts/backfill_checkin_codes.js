// M15 - One-time backfill of `bookings.checkin_code`.
//
// Migration 048 adds the column NULL. New bookings get a code at create time
// (bookings.controller.create), but bookings made BEFORE 048 have none. This
// mints a code for every still-relevant booking so those bookers can check in.
//
// Scope: rows with checkin_code IS NULL, not trashed, and end_at > NOW()
//        (past bookings can never be checked in, so we leave them NULL).
//
// Usage:
//     node backend/scripts/backfill_checkin_codes.js            → backfill
//     node backend/scripts/backfill_checkin_codes.js --dry-run  → count only
//
// Safety:
//   - Only ever sets checkin_code where it is currently NULL (never rewrites
//     an existing code, so re-running is safe / idempotent).
//   - Uniqueness enforced per-row via checkinCode.generateUnique + the
//     UNIQUE index as a backstop.

const { pool, query, execute } = require('../src/db/pool');
const checkinCode = require('../src/utils/checkinCode');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const targets = await query(
    'SELECT id FROM `bookings` ' +
    ' WHERE checkin_code IS NULL AND trash = 0 AND end_at > NOW() ' +
    ' ORDER BY id'
  );

  console.log(`[backfill_checkin_codes] ${targets.length} booking(s) need a code.`);
  if (dryRun) { console.log('[backfill_checkin_codes] --dry-run: no writes.'); return; }

  let done = 0;
  for (const row of targets) {
    const code = await checkinCode.generateUnique(query);
    // Guard WHERE checkin_code IS NULL so a concurrent create can't be clobbered.
    const res = await execute(
      'UPDATE `bookings` SET checkin_code = ? WHERE id = ? AND checkin_code IS NULL',
      [code, row.id]
    );
    if (res.affectedRows === 1) done += 1;
    if (done % 100 === 0 && done > 0) console.log(`  …${done}/${targets.length}`);
  }
  console.log(`[backfill_checkin_codes] done — ${done} code(s) minted.`);
}

main()
  .catch((e) => { console.error('[backfill_checkin_codes] FAILED:', e); process.exitCode = 1; })
  .finally(() => pool.end());
