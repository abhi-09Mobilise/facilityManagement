// Embassy employees -> FM users importer (runs INSIDE the bridge, after the
// org-hierarchy sync so organisations already exist to attach users to).
//
// READS Embassy (`1_user_master` + `1_usr_pl_map`, read-only) and WRITES FM
// `users`. Idempotent: keyed on `users.external_id` = the Embassy user id
// (migration 054, unique-when-set), so a daily run UPSERTS, never duplicates.
//
// Scope: only employees who have an ACTIVE, in-date pl mapping to a pl under
// the Embassy org (org_id 13) — i.e. one of the organisations we synced. That
// naturally limits the import to tenant-10 people (not all ~17k IFMS users).
//
// Org resolution:
//   1_usr_pl_map.user_id -> 1_user_master.id
//   1_usr_pl_map.pl_id   -> FM organisation (organisations.source_ref = pl_id)
// A user with several active pl rows is attached to the most recent one.
//
// Auth: these are SSO-only accounts (Embassy↔FMS). We set a NON-bcrypt random
// string as the password so local login (bcrypt.compare) always fails — the
// user can only arrive via the shared-JWT SSO path, which matches on email.

const crypto = require('crypto');
const db = require('./db');       // Embassy read
const fmDb = require('./fmDb');   // FM write

function currentMode() {
  return String(process.env.BRIDGE_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
}

// Deliberately NOT a valid bcrypt hash → bcrypt.compare() returns false, so
// there is no local password that can log into these accounts.
function unusablePassword() {
  return '!embassy-sso-nologin-' + crypto.randomBytes(24).toString('hex');
}

function cleanMobile(m) {
  if (!m) return null;
  const s = String(m).replace(/[^0-9+]/g, '');
  return s ? s.slice(0, 20) : null;
}

// Embassy encrypts PII (name/lname/mobile) with Laravel Crypt — the ciphertext
// is base64 of a {"iv":...} JSON, i.e. starts with "eyJpdiI6". Detect it so we
// never store ciphertext in FM.
function looksEncrypted(v) { return typeof v === 'string' && /^eyJpdiI6/.test(v.trim()); }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Option (a): derive a readable display name from the email local-part, since
// the Embassy `name` column is encrypted. "puneet.yadav@x" -> {Puneet, Yadav}.
function deriveName(email) {
  if (!email) return { name: null, lname: null };
  const local = String(email).split('@')[0] || '';
  const parts = local.split(/[._\-+]+/).filter(Boolean).map(cap);
  return { name: parts[0] || null, lname: parts.slice(1).join(' ') || null };
}

// Live: employees with an active, in-date pl mapping to an org under `orgId`.
// Ordered so the first row per user is their most recent pl mapping.
async function fetchEmployeesLive(orgId) {
  const rows = await db.query(
    'SELECT u.id, u.email, u.name, u.lname, u.mobile, u.job_desc, u.status, u.trash, u.is_approved, ' +
    '       m.pl_id ' +
    '  FROM `1_user_master` u ' +
    '  JOIN `1_usr_pl_map` m  ON m.user_id = u.id ' +
    '  JOIN `0_org_pl`     pl ON pl.pl_id  = m.pl_id AND pl.org_id = ? AND pl.trash = 0 ' +
    ' WHERE u.trash = 0 ' +
    '   AND m.status = 1 AND m.trash = 0 ' +
    '   AND m.valid_from <= CURDATE() AND m.valid_to >= CURDATE() ' +
    ' ORDER BY u.id, m.valid_from DESC, m.map_id DESC',
    [orgId]
  );
  const byUser = new Map();
  for (const r of rows) if (!byUser.has(r.id)) byUser.set(r.id, r); // first = most recent
  return [...byUser.values()].map((r) => {
    const email = (r.email || '').toLowerCase().trim() || null;
    // Option (a): Embassy name/lname/mobile are Laravel-encrypted ciphertext.
    // Derive a readable name from the email; drop any field that's ciphertext.
    const dn = deriveName(email);
    return {
      id: Number(r.id),
      email,
      name: looksEncrypted(r.name) ? dn.name : ((r.name && String(r.name).trim()) || dn.name),
      lname: looksEncrypted(r.lname) ? dn.lname : ((r.lname && String(r.lname).trim()) || dn.lname),
      mobile: looksEncrypted(r.mobile) ? null : cleanMobile(r.mobile),
      designation: looksEncrypted(r.job_desc) ? null : (r.job_desc ? String(r.job_desc).slice(0, 80) : null),
      status: Number(r.status) === 1 ? 1 : 0,
      is_approved: String(r.is_approved) === '1' ? 1 : 0,
      pl_id: Number(r.pl_id),
    };
  });
}

// Small deterministic mock set (pl_ids match orgHierarchy.mockHierarchy).
function mockEmployees() {
  return [
    { id: 9001, email: 'asha.rao@embassy.test',  name: 'Asha',  lname: 'Rao',  mobile: '9000000001', designation: 'Manager',  status: 1, is_approved: 1, pl_id: 101 },
    { id: 9002, email: 'vikram.n@embassy.test',   name: 'Vikram', lname: 'N',   mobile: '9000000002', designation: 'Engineer', status: 1, is_approved: 1, pl_id: 101 },
    { id: 9003, email: '',                        name: 'No Email', lname: '',  mobile: null,          designation: null,       status: 1, is_approved: 1, pl_id: 102 },
  ];
}

async function findByExternalId(conn, externalId) {
  const [rows] = await conn.execute(
    'SELECT id FROM `users` WHERE external_id = ? LIMIT 1',
    [String(externalId)]
  );
  return rows.length ? rows[0].id : null;
}

// Globally-unique username: prefer email, else emb-<id>, else emb-<id>-<rand>.
async function pickUsername(conn, email, extId) {
  const tryList = [];
  if (email) tryList.push(email);
  tryList.push('emb-' + extId);
  for (const c of tryList) {
    const [rows] = await conn.execute('SELECT id FROM `users` WHERE username = ? LIMIT 1', [c]);
    if (rows.length === 0) return c;
  }
  return 'emb-' + extId + '-' + crypto.randomBytes(3).toString('hex');
}

async function upsertUser(conn, tenantId, organisationId, e, stats) {
  // Without an email these accounts can't SSO, so import them inactive.
  const effStatus = e.email ? e.status : 0;
  const existing = await findByExternalId(conn, e.id);

  if (existing) {
    await conn.execute(
      'UPDATE `users` SET tenant_id = ?, organisation_id = ?, email = ?, name = ?, lname = ?, ' +
      '       mobile = ?, designation = ?, status = ?, is_approved = ? WHERE id = ?',
      [tenantId, organisationId, e.email, e.name, e.lname, e.mobile, e.designation, effStatus, e.is_approved, existing]
    );
    stats.updated++;
    return existing;
  }

  const username = await pickUsername(conn, e.email, e.id);
  await conn.execute(
    'INSERT INTO `users` ' +
    '  (external_id, tenant_id, organisation_id, username, password, name, lname, email, mobile, designation, role, status, is_approved) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee', ?, ?)",
    [String(e.id), tenantId, organisationId, username, unusablePassword(), e.name, e.lname, e.email, e.mobile, e.designation, effStatus, e.is_approved]
  );
  stats.inserted++;
}

/**
 * Pull Embassy employees for `orgId` and upsert into FM tenant `tenantId`.
 * Resolves organisation from the pl mapping against already-synced FM orgs.
 * dryRun rolls back (writes nothing). Returns a summary.
 */
async function runImport({ orgId = 13, tenantId = 10, dryRun = false } = {}) {
  const employees = currentMode() === 'mock' ? mockEmployees() : await fetchEmployeesLive(orgId);

  // pl_id -> FM organisation id, from the orgs the hierarchy sync wrote.
  const orgRows = await fmDb.query(
    "SELECT id, source_ref FROM `organisations` WHERE tenant_id = ? AND source_system = 'embassy' AND source_ref IS NOT NULL",
    [tenantId]
  );
  const plToFm = new Map(orgRows.map((o) => [Number(o.source_ref), o.id]));

  const stats = { inserted: 0, updated: 0, skipped: 0 };
  const skipped = [];

  const conn = await fmDb.getConnection();
  try {
    await conn.beginTransaction();
    for (const e of employees) {
      const fmOrg = plToFm.get(e.pl_id) || null;
      if (!fmOrg) {
        stats.skipped++;
        if (skipped.length < 50) skipped.push(`user ${e.id} (${e.email || 'no-email'}) — pl ${e.pl_id} is not a synced FM org`);
        continue;
      }
      await upsertUser(conn, tenantId, fmOrg, e, stats);
    }
    if (dryRun) await conn.rollback();
    else await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { orgId, tenantId, dryRun, mode: currentMode(), fetched: employees.length, stats, skipped };
}

// READ-ONLY preview: fetch the employees that WOULD be synced + resolve each to
// its FM org, and report insert-vs-update — without writing anything. Used by
// scripts/preview_users.js so you can see exactly who gets pulled.
async function previewUsers({ orgId = 13, tenantId = 10 } = {}) {
  const employees = currentMode() === 'mock' ? mockEmployees() : await fetchEmployeesLive(orgId);

  const orgRows = await fmDb.query(
    "SELECT id, source_ref FROM `organisations` WHERE tenant_id = ? AND source_system = 'embassy' AND source_ref IS NOT NULL",
    [tenantId]
  );
  const plToFm = new Map(orgRows.map((o) => [Number(o.source_ref), o.id]));

  const users = [];
  const skippedList = [];
  let toInsert = 0, toUpdate = 0;

  for (const e of employees) {
    const fmOrg = plToFm.get(e.pl_id) || null;
    if (!fmOrg) {
      skippedList.push({ external_id: e.id, email: e.email, pl_id: e.pl_id, reason: 'pl not a synced FM org' });
      continue;
    }
    const existing = await fmDb.query('SELECT id FROM `users` WHERE tenant_id = ? AND external_id = ? LIMIT 1', [tenantId, String(e.id)]);
    const action = existing.length ? 'update' : 'insert';
    if (action === 'insert') toInsert++; else toUpdate++;
    users.push({
      external_id: e.id, email: e.email, name: e.name, lname: e.lname,
      designation: e.designation, pl_id: e.pl_id, organisation_id: fmOrg,
      status: e.email ? e.status : 0, action,
    });
  }

  return { orgId, tenantId, mode: currentMode(), fetched: employees.length, toInsert, toUpdate, skipped: skippedList.length, skippedList, users };
}

module.exports = { runImport, previewUsers };
