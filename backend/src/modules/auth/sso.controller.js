// Embassy SSO handoff — exchange an Embassy session JWT for an FMS JWT.
//
//   POST /api/auth/sso/embassy
//     body: { token }   (also accepts { handoff_token } or Authorization: Bearer <token>)
//     -> 200 { status:true,  data: { token: <FMS JWT>, user } }
//     -> 4xx { status:false, msg }
//
// Flow:
//   1. verifyEmbassyToken() — HS256 signature + expiry against EMBASSY_SHARED_SECRET
//   2. sub  ->  FMS user via users.external_id (populated by the employee sync)
//   3. gate — active + approved + live tenant/org (same checks as password login)
//   4. signToken() — mint a normal FMS JWT that the rest of the API already trusts
//
// The Embassy token is used ONLY here. Every other FMS endpoint keeps using the
// minted FMS JWT through the normal authRequired middleware — so this one
// exchange is the single place that trusts Embassy, and FMS's own JWT_SECRET
// stays independent of Embassy's secret.

const { query } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { signToken } = require('../../middleware/auth');
const { verifyEmbassyToken, EmbassySsoError } = require('../../middleware/embassySso');

// Resolve the Embassy user id (token `sub`) to an FMS user through external_id.
// Mirrors the SELECT auth.controller.login uses so signToken()/publicUser()
// receive the same fields.
async function loadUserByExternalId(externalId) {
  const rows = await query(
    'SELECT u.id, u.username, u.name, u.lname, u.email, u.role, ' +
    '       u.tenant_id, u.organisation_id, u.department_id, ' +
    '       u.status, u.is_approved, ' +
    '       t.name AS tenant_name,       t.status AS tenant_status, ' +
    '       o.name AS organisation_name, o.status AS organisation_status ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `tenants`       t ON t.id = u.tenant_id ' +
    '  LEFT JOIN `organisations` o ON o.id = u.organisation_id ' +
    ' WHERE u.external_id = ? AND u.trash = 0 ' +
    ' LIMIT 1',
    [String(externalId)],
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
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const token = (req.body && (req.body.token || req.body.handoff_token)) || bearer || '';
console.log("TOKEN :" , token)
  let decoded;
  try {
    decoded = verifyEmbassyToken(token);
  } catch (err) {
    if (err instanceof EmbassySsoError) return fail(res, err.message, err.httpStatus);
    throw err;
  }

  // sub (Embassy user id) -> FMS user. Not auto-provisioning: the employee sync
  // must have created the FMS user (matching external_id) first; a stale Embassy
  // roster can't conjure FMS accounts.
  const user = await loadUserByExternalId(decoded.sub);
  if (!user) {
    return fail(res, 'User is not provisioned in FMS. Please contact your administrator.', 401);
  }

  // Same gating password login runs — a disabled FMS user can't slip in via SSO.
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

  // Mint the normal FMS JWT { sub:id, username, name, email, role, tenant_id,
  // organisation_id } from the real FMS row — same shape the login issues.
  const fmsToken = signToken(user);
  return ok(res, { token: fmsToken, user: publicUser(user) }, 'Embassy SSO login successful');
});
