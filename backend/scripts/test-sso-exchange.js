#!/usr/bin/env node
//
// TEST-ONLY — end-to-end check of the Embassy SSO handoff, in-process (no HTTP
// server needed). Mints a handoff JWT with EMBASSY_SHARED_SECRET (like Embassy
// would), then drives the REAL POST /api/auth/sso/embassy handler
// (sso.controller.exchange) against the REAL FM DB and prints each outcome.
// Never ship this script to production.
//
// Usage (run from backend/):
//   node scripts/test-sso-exchange.js                       # default email below
//   node scripts/test-sso-exchange.js --email a@b.com
//
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const sso = require('../src/modules/auth/sso.controller');
const pool = require('../src/db/pool').pool;

const argEmail = (() => {
  const i = process.argv.indexOf('--email');
  return i >= 0 ? process.argv[i + 1] : 'puneet.yadav@mobilise.co.in';
})().toLowerCase();

// Fake Express res that records the controller's status + JSON body.
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function callExchange(handoff_token) {
  const res = fakeRes();
  await sso.exchange({ body: { handoff_token } }, res, (err) => { res.err = err; });
  return res;
}
function mint(email, secret, opts = {}) {
  return jwt.sign(
    { email, sub: email, name: `Test (${email})`, role: 'employee' },
    secret,
    {
      algorithm: 'HS256',
      issuer: opts.issuer || config.embassy.issuer,
      audience: opts.audience || config.embassy.audience,
      expiresIn: opts.ttl || 60,
      jwtid: crypto.randomUUID(),
    },
  );
}

async function main() {
  console.log('\n=== Embassy SSO config (from backend/.env) ===');
  console.log(`EMBASSY_SSO_ENABLED : ${config.embassy.ssoEnabled}`);
  console.log(`EMBASSY_SHARED_SECRET set? : ${config.embassy.sharedSecret ? `yes (len ${config.embassy.sharedSecret.length})` : 'NO — cannot test'}`);
  console.log(`issuer / audience   : ${config.embassy.issuer} / ${config.embassy.audience}`);
  console.log(`FM DB               : ${config.db.host}/${config.db.database}  (lookup runs here)`);
  console.log(`testing email       : ${argEmail}`);

  if (!config.embassy.sharedSecret) { process.exitCode = 1; return; }

  // The real exchange() 404s if SSO is disabled. Flip the cached flag ON just
  // for this in-process test so we exercise the full verify+lookup path. (Does
  // NOT touch .env — production still needs EMBASSY_SSO_ENABLED=true.)
  if (!config.embassy.ssoEnabled) {
    console.log('\n(note) EMBASSY_SSO_ENABLED is not "true" in .env — forcing it ON for this test only.');
    config.embassy.ssoEnabled = true;
  }

  const secret = config.embassy.sharedSecret;
  const show = (label, res) => {
    const u = res.body && res.body.data && res.body.data.user;
    console.log(`\n--- ${label} ---`);
    console.log(`HTTP ${res.statusCode}  status=${res.body && res.body.status}  msg=${res.body && res.body.msg}`);
    if (u) console.log(`user: #${u.id} ${u.name} ${u.lname || ''} <${u.email}> role=${u.role} tenant=${u.tenant_id} org=${u.organisation_id}`);
    if (res.body && res.body.data && res.body.data.token) console.log(`FMS JWT: ${String(res.body.data.token).slice(0, 32)}… (len ${res.body.data.token.length})`);
  };

  // 1) Happy path — valid token for a provisioned, active user.
  const good = mint(argEmail, secret);
  show('1. valid handoff token (expect HTTP 200 + FMS JWT)', await callExchange(good));

  // 2) Replay — same token again (expect 401 replay rejected).
  show('2. replay same token (expect HTTP 401)', await callExchange(good));

  // 3) Wrong secret — forged signature (expect 401 invalid).
  show('3. wrong signing secret (expect HTTP 401)', await callExchange(mint(argEmail, 'not-the-real-secret-xxxxxxxx')));

  // 4) Unknown user — valid signature, email not in FM (expect 401 not provisioned).
  show('4. unknown email (expect HTTP 401 not provisioned)', await callExchange(mint('nobody.here@mobilise.co.in', secret)));

  console.log('');
}

main()
  .catch((e) => { console.error('[test-sso-exchange] FAILED:', e && e.stack || e); process.exitCode = 1; })
  .finally(async () => { try { await pool.end(); } catch { /* noop */ } });
