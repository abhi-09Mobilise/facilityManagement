// Apply the Embassy -> FM employee sync (WRITES to the FM DB). This is the
// write counterpart to preview_users.js. Idempotent (UPSERT on external_id),
// so re-running is safe.
//
// Run from the bridge folder (needs its .env: BRIDGE_MODE=live, EMBASSY_DB_*,
// FM_DB_*):
//     node scripts/pull_users.js          # apply (writes)
//     node scripts/pull_users.js --dry    # roll back (writes nothing)
//
// Scope defaults to Embassy org_id 13 -> FM tenant 10 (override via
// EMBASSY_ORG_ID / FM_TENANT_ID in .env).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const importUsers = require('../src/importUsers');
const db = require('../src/db');
const fmDb = require('../src/fmDb');

const dryRun = process.argv.includes('--dry');

async function main() {
  const orgId = Number(process.env.EMBASSY_ORG_ID || 13);
  const tenantId = Number(process.env.FM_TENANT_ID || 10);

  const r = await importUsers.runImport({ orgId, tenantId, dryRun });

  console.log(`\nMode: ${r.mode}   Embassy org ${orgId} -> FM tenant ${tenantId}   ${dryRun ? '(DRY RUN — rolled back)' : '(APPLIED)'}`);
  console.log(`Fetched ${r.fetched}  =>  INSERT ${r.stats.inserted} · UPDATE ${r.stats.updated} · SKIP ${r.stats.skipped}`);
  if (r.skipped.length) {
    console.log(`\nSkipped:`);
    r.skipped.forEach((s) => console.log(`  ${s}`));
  }
  console.log('');
}

main()
  .catch((e) => { console.error('[pull_users] FAILED:', e && e.message); process.exitCode = 1; })
  .finally(async () => { try { await db.close(); } catch { /* noop */ } try { await fmDb.end(); } catch { /* noop */ } });
