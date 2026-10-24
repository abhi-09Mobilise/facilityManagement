// Preview which Embassy employees would be pulled into the FM DB.
// READ-ONLY: queries Embassy (1_user_master + 1_usr_pl_map) and FM
// (organisations) but writes NOTHING. Prints the list + insert/update plan.
//
// Run from the bridge folder (needs its .env: BRIDGE_MODE=live, EMBASSY_DB_*,
// FM_DB_*):
//     node scripts/preview_users.js
//     node scripts/preview_users.js --json     # machine-readable
//
// Scope defaults to Embassy org_id 13 -> FM tenant 10 (override via
// EMBASSY_ORG_ID / FM_TENANT_ID in .env).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const importUsers = require('../src/importUsers');
const db = require('../src/db');
const fmDb = require('../src/fmDb');

const asJson = process.argv.includes('--json');

function pad(v, n) { return String(v == null ? '' : v).slice(0, n).padEnd(n); }

async function main() {
  const orgId = Number(process.env.EMBASSY_ORG_ID || 13);
  const tenantId = Number(process.env.FM_TENANT_ID || 10);

  const r = await importUsers.previewUsers({ orgId, tenantId });

  if (asJson) { console.log(JSON.stringify(r, null, 2)); return; }

  console.log(`\nMode: ${r.mode}   Embassy org ${orgId} -> FM tenant ${tenantId}`);
  console.log(`Fetched ${r.fetched} employee(s)  =>  INSERT ${r.toInsert} · UPDATE ${r.toUpdate} · SKIP ${r.skipped}\n`);

  console.log(`${pad('ACTION', 7)} ${pad('EXT_ID', 7)} ${pad('EMAIL', 34)} ${pad('NAME', 22)} ${pad('PL', 5)} ORG`);
  console.log('-'.repeat(84));
  for (const u of r.users) {
    console.log(
      `${pad(u.action, 7)} ${pad(u.external_id, 7)} ${pad(u.email || '(no email)', 34)} ` +
      `${pad([u.name, u.lname].filter(Boolean).join(' '), 22)} ${pad(u.pl_id, 5)} ${u.organisation_id}`
    );
  }
  if (r.skippedList.length) {
    console.log(`\nSkipped ${r.skippedList.length} (pl not under a synced FM org):`);
    r.skippedList.slice(0, 50).forEach((s) => console.log(`  user ${s.external_id} (${s.email || 'no-email'}) — pl ${s.pl_id}`));
    if (r.skippedList.length > 50) console.log(`  …and ${r.skippedList.length - 50} more`);
  }
  console.log('\n(Nothing was written — this is a preview. Run the daily sync / POST /org/import?only=users to apply.)\n');
}

main()
  .catch((e) => { console.error('[preview_users] FAILED:', e && e.message); process.exitCode = 1; })
  .finally(async () => { try { await db.close(); } catch { /* noop */ } try { await fmDb.end(); } catch { /* noop */ } });
