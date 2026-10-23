#!/usr/bin/env node
//
// Local Embassy simulator — mints handoff JWTs that FMS can exchange via
// POST /api/auth/sso/embassy. Signs with the HS256 shared secret from
// config.embassy.sharedSecret (same secret Embassy uses in production).
// Never ship this script to production.
//
// Usage:
//   node backend/scripts/mint-test-handoff.js --email admin@umbrella.local
//   node backend/scripts/mint-test-handoff.js --email admin@umbrella.local --user-id 42
//   node backend/scripts/mint-test-handoff.js --email admin@umbrella.local --ttl 300
//
// Prints the token (and a ready-to-paste Postman body) to stdout.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const nxt = argv[i + 1];
    if (!nxt || nxt.startsWith('--')) { out[key] = true; continue; }
    out[key] = nxt;
    i += 1;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);

  const email = (args.email || '').toString().trim().toLowerCase();
  if (!email) {
    console.error('ERR: --email <address> is required (must match an FMS user)');
    console.error('Example: node mint-test-handoff.js --email admin@umbrella.local');
    process.exit(1);
  }

  const secret = config.embassy.sharedSecret;
  if (!secret) {
    console.error('ERR: EMBASSY_SHARED_SECRET is not set in backend/.env');
    console.error('Add it with the exact value Embassy shared with you.');
    process.exit(1);
  }

  const ttl = Math.max(10, parseInt(args.ttl || '60', 10));
  const payload = {
    email: email,
    sub:   args['user-id'] ? String(args['user-id']) : email,
    name:  args.name || `Test User (${email})`,
    tenant_id:       args['tenant-id']       ? Number(args['tenant-id'])       : null,
    organisation_id: args['organisation-id'] ? Number(args['organisation-id']) : null,
    role: args.role || 'employee',
  };

  const token = jwt.sign(payload, secret, {
    algorithm: 'HS256',
    issuer:    config.embassy.issuer,
    audience:  config.embassy.audience,
    expiresIn: ttl,
    jwtid:     crypto.randomUUID(),
  });

  const decoded = jwt.decode(token, { complete: true });
  const expIso = new Date(decoded.payload.exp * 1000).toISOString();

  console.log('----- Embassy handoff token (TEST) -----');
  console.log(token);
  console.log('');
  console.log(`Expires at: ${expIso}  (in ${ttl}s)`);
  console.log('');
  console.log('Postman body for POST /api/auth/sso/embassy :');
  console.log(JSON.stringify({ handoff_token: token }, null, 2));
}

main();
