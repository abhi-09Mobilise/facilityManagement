export const meta = {
  name: 'migrate-test-fix',
  description: 'Migrate the DB, test the four booking/check-in operations, then fix what lags',
  phases: [
    { title: 'Migrate', detail: 'apply pending migrations (db-migrator)' },
    { title: 'Test', detail: 'exercise ops, write findings report (ops-tester)' },
    { title: 'Fix', detail: 'developer fixes flagged issues (fix-developer)' },
  ],
}

// Options (pass via Workflow args):
//   { reportPath?: string, autoFix?: boolean }
// autoFix defaults to true (full pipeline). Pass { autoFix: false } to stop
// after the findings report so a human can review before any code changes.
const reportPath = (args && args.reportPath) || 'reports/ops-audit.md'
const autoFix = !args || args.autoFix !== false

const MIGRATE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    appliedBefore: { type: 'array', items: { type: 'string' } },
    pendingAfter: { type: 'array', items: { type: 'string' } },
    latestApplied: { type: 'string' },
    error: { type: ['string', 'null'] },
    notes: { type: 'string' },
  },
  required: ['ok'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    reportPath: { type: 'string' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          severity: { type: 'string' },
          status: { type: 'string' },
          what: { type: 'string' },
          where: { type: 'string' },
        },
      },
    },
  },
  required: ['issues'],
}

// 1) Migrate — stop the whole pipeline if it can't complete (e.g. DB down).
phase('Migrate')
const migrate = await agent(
  'Apply all pending database migrations and report the result per your instructions.',
  { agentType: 'db-migrator', phase: 'Migrate', schema: MIGRATE_SCHEMA }
)
if (!migrate || !migrate.ok) {
  log('Migration did not complete — stopping before test/fix. ' + ((migrate && migrate.error) || ''))
  return { migrate, tested: false, fixed: false }
}
log('Migrated. Latest applied: ' + (migrate.latestApplied || '(none pending)'))

// 2) Test — diagnose the four requirements, write the findings report.
phase('Test')
const test = await agent(
  `Migration is done (latest: ${migrate.latestApplied}). Exercise the four functional ` +
  `requirements and write your findings report to ${reportPath}. Diagnosis only — never edit code.`,
  { agentType: 'ops-tester', phase: 'Test', schema: TEST_SCHEMA }
)
const issues = (test && test.issues) || []
log(`Tester flagged ${issues.length} issue(s).`)

if (!issues.length) return { migrate, test, fixed: false, note: 'Nothing to fix.' }
if (!autoFix) return { migrate, test, fixed: false, note: 'autoFix=false — stopped after report for human review.' }

// 3) Fix — hand the report + issues to the developer agent.
phase('Fix')
const fix = await agent(
  `Read the findings report at ${reportPath} and fix ONLY these flagged issues:\n` +
  JSON.stringify(issues, null, 2) +
  `\nVerify with node --check / tsc. Do not commit or push.`,
  { agentType: 'fix-developer', phase: 'Fix' }
)

return { migrate, test, fix }
