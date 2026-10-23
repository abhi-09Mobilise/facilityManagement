// Embassy SSO handoff — token exchange endpoint.
//
//   POST /api/auth/sso/embassy
//     { handoff_token: "<RS256 JWT from Embassy>" }
//     -> { status, data: { token, user } }   // FMS JWT + user profile
//
// Flow:
//   1. verifyHandoffToken()  — signature + exp + iss + aud + jti claim
//   2. replay-check           — jti must not have been seen before
//   3. user lookup            — WHERE email = decoded.email
//   4. tenant/account gating  — same checks login runs (active, approved)
//   5. signToken()            — mint the normal FMS JWT
//
// Replay prevention: short-lived in-memory Set. Fine for a single-process
// test environment. For production (multi-instance) swap this for a Redis
// SETNX or a DB-backed `sso_jti_seen` table with TTL — the hook point is
// `isReplay()` / `markSeen()` below, so the controller logic doesn't change.

const { query } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { signToken } = require('../../middleware/auth');
const { verifyHandoffToken, EmbassySsoError } = require('../../middleware/embassySso');

// jti → expiry-timestamp (ms). Periodically culled so the Map doesn't grow
// unbounded over a long-running process.
const seenJtis = new Map();
let cullTimer = null;

function startCullTimer() {
  if (cullTimer) return;
  cullTimer = setInterval(function cull() {
    const now = Date.now();
    for (const [jti, expMs] of seenJtis) {
      if (expMs <= now) seenJtis.delete(jti);
    }
  }, 60 * 1000);
  // Don't block Node from exiting (e.g. during tests).
  if (typeof cullTimer.unref === 'function') cullTimer.unref();
}

function isReplay(jti) {
  const expMs = seenJtis.get(jti);
  if (!expMs) return false;
  if (expMs <= Date.now()) {
    seenJtis.delete(jti);
    return false;
  }
  return true;
}

function markSeen(jti, expEpochSec) {
  startCullTimer();
  seenJtis.set(jti, expEpochSec * 1000);
}

// Mirrors the SELECT shape used by auth.controller.login so publicUser()
// and signToken() both receive the same fields.
//
// Lookup is by email because that is the identifier the Embassy app sends
// in the handoff token's `email` claim and the integration contract agreed
// with the Embassy team. Email is lowercased + trimmed to avoid casing /
// whitespace drift between the two systems (users table should enforce
// the same canonicalisation at write time).
async function loadUserByEmail(email) {
  const rows = await query(
    'SELECT u.id, u.username, u.name, u.lname, u.email, u.role, ' +
    '       u.tenant_id, u.organisation_id, u.department_id, ' +
    '       u.status, u.is_approved, ' +
    '       t.name   AS tenant_name,   t.status AS tenant_status, ' +
    '       o.name   AS organisation_name, o.status AS organisation_status ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `tenants`       t ON t.id = u.tenant_id ' +
    '  LEFT JOIN `organisations` o ON o.id = u.organisation_id ' +
    ' WHERE u.email = ? AND u.trash = 0 ' +
    ' LIMIT 1',
    [String(email).toLowerCase().trim()],
  );
  return rows[0] || null;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    lname: u.lname,
    email: u.email,
    role: u.role,
    tenant_id: u.tenant_id,
    tenant_name: u.tenant_name || null,
    organisation_id: u.organisation_id || null,
    organisation_name: u.organisation_name || null,
    department_id: u.department_id || null,
  };
}

exports.exchange = asyncHandler(async function (req, res) {
  const token = (req.body && req.body.handoff_token) || '';

  let decoded;
  try {
    decoded = verifyHandoffToken(token);
  } catch (err) {
    if (err instanceof EmbassySsoError) {
      return fail(res, err.message, err.httpStatus);
    }
    throw err;
  }

  if (isReplay(decoded.jti)) {
    return fail(res, 'Handoff token already used (replay rejected)', 401);
  }

  if (!decoded.email) {
    return fail(res, 'Handoff token is missing the required "email" claim', 400);
  }
  const user = await loadUserByEmail(decoded.email);
  if (!user) {
    // Deliberately not auto-provisioning — a stale Embassy roster shouldn't
    // conjure accounts on FMS. The admin creates the FMS user with a
    // matching email first; then this handoff can authenticate them.
    return fail(
      res,
      'User is not provisioned in FMS. Please contact your administrator.',
      401,
    );
  }

  // Same gating the password login runs — a disabled user on FMS can't
  // sneak in via SSO.
  if (user.status !== 1 || user.is_approved !== 1) {
    return fail(res, 'Account is inactive or not approved', 403);
  }
  if (user.role !== 'super_admin') {
    if (user.tenant_id && user.tenant_status !== 'active') {
      return fail(res, 'This tenant account is inactive. Contact your administrator.', 403);
    }
    if (user.organisation_id && Number(user.organisation_status) === 0) {
      return fail(res, 'Your organisation is inactive. Contact your administrator.', 403);
    }
  }

  // Guard against cross-tenant token forgery when a tenant_id claim IS
  // present in the handoff token. (Claim is optional — single-tenant
  // Embassy deployments can leave it unset.)
  if (decoded.tenant_id != null && Number(decoded.tenant_id) !== Number(user.tenant_id)) {
    return fail(
      res,
      'Tenant mismatch between handoff token and FMS user record.',
      403,
    );
  }

  markSeen(decoded.jti, decoded.exp);

  const fmsToken = signToken(user);
  return ok(
    res,
    { token: fmsToken, user: publicUser(user) },
    'Embassy SSO login successful',
  );
});
