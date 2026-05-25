// Basic auth: login, register, me, logout.
// Backed by the `users` table (multi-tenant) - see migration 005.

const bcrypt = require('bcryptjs');
const { query, execute } = require('../../db/pool');
const { signToken } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { issueToken, consumeToken, markUsed } = require('../../utils/passwordResetTokens');
const mailer = require('../../utils/mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    department_id: u.department_id || null,
  };
}

// POST /api/auth/login - { username, password }
// `username` accepts either username or email.
exports.login = asyncHandler(async function (req, res) {
  const body = req.body || {};
  const username = body.username;
  const password = body.password;

  if (!username || !password) {
    return fail(res, 'Username and password are required', 422);
  }

  const rows = await query(
    'SELECT u.id, u.tenant_id, u.department_id, u.username, u.name, u.lname, u.email, u.password, u.role, ' +
    '       u.status, u.trash, u.is_approved, u.login_attempts, u.login_clear_datetime, ' +
    '       t.name AS tenant_name ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `tenants` t ON t.id = u.tenant_id ' +
    ' WHERE (u.username = ? OR u.email = ?) AND u.trash = 0 ' +
    ' LIMIT 1',
    [username, username]
  );

  

  if (rows.length === 0) return fail(res, 'Invalid credentials', 401);
  const user = rows[0];

  if ((user.login_attempts || 0) > 4 && user.login_clear_datetime) {
    const now = new Date();
    const until = new Date(user.login_clear_datetime);
    if (now < until) {
      return fail(res, 'Account locked due to multiple failed attempts. Try again later.', 423);
    }
  }

  const passOk = await bcrypt.compare(password, user.password || '');
  if (!passOk) {
    const clearAt = new Date(Date.now() + 15 * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      'UPDATE `users` ' +
      '   SET login_attempts = login_attempts + 1, login_clear_datetime = ? ' +
      ' WHERE id = ?',
      [clearAt, user.id]
    );
    return fail(res, 'Invalid credentials', 401);
  }

  if (user.status !== 1 || user.is_approved !== 1) {
    return fail(res, 'Account is inactive or not approved', 403);
  }

  await execute(
    'UPDATE `users` SET login_attempts = 0, login_clear_datetime = NULL WHERE id = ?',
    [user.id]
  );

  const token = signToken(user);
  return ok(res, { token: token, user: publicUser(user) }, 'Login successful');
});

// POST /api/auth/register - public self-signup.
// New accounts default to role='employee'. tenant_id is required - public
// signups join an existing tenant (the slug is on the request).
//
// body: { username, password, name?, lname?, email?, mobile?, tenant_slug }
//
// Super admins and tenant admins are created via the seed script or via
// /api/users (admin CRUD), never via this endpoint.
exports.register = asyncHandler(async function (req, res) {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const tenantSlug = String(body.tenant_slug || '').trim();

  if (!username)                    return fail(res, 'Username is required', 422);
  if (username.length < 3)          return fail(res, 'Username must be at least 3 characters', 422);
  if (!password)                    return fail(res, 'Password is required', 422);
  if (password.length < 6)          return fail(res, 'Password must be at least 6 characters', 422);
  if (body.email && !EMAIL_RE.test(body.email)) return fail(res, 'Email is not valid', 422);
  if (!tenantSlug)                  return fail(res, 'Tenant slug is required', 422);

  const tenants = await query(
    "SELECT id FROM `tenants` WHERE slug = ? AND trash = 0 AND status IN ('active','trial') LIMIT 1",
    [tenantSlug]
  );
  if (tenants.length === 0) return fail(res, 'Unknown tenant', 404);
  const tenantId = tenants[0].id;

  const emailParam = body.email || null;
  const dupe = await query(
    'SELECT id FROM `users` ' +
    ' WHERE username = ? OR (? IS NOT NULL AND email = ?) ' +
    ' LIMIT 1',
    [username, emailParam, emailParam]
  );
  if (dupe.length > 0) return fail(res, 'Username or email already taken', 409);

  const hash = await bcrypt.hash(password, 10);
  const r = await execute(
    'INSERT INTO `users` ' +
    '   (tenant_id, username, password, name, lname, email, mobile, role, status, is_approved, trash) ' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ' + "'employee', 1, 1, 0)",
    [
      tenantId, username, hash,
      body.name || null, body.lname || null,
      emailParam, body.mobile || null,
    ]
  );

  const newUser = {
    id: r.insertId,
    tenant_id: tenantId,
    username: username,
    name: body.name || null,
    lname: body.lname || null,
    email: emailParam,
    role: 'employee',
  };
  const token = signToken(newUser);

  return created(res, { token: token, user: publicUser(newUser) }, 'Account created');
});

// GET /api/auth/me
exports.me = asyncHandler(async function (req, res) {
  const rows = await query(
    'SELECT u.id, u.tenant_id, u.department_id, u.username, u.name, u.lname, u.email, u.mobile, u.role, u.user_img, ' +
    '       t.name AS tenant_name ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `tenants` t ON t.id = u.tenant_id ' +
    ' WHERE u.id = ?',
    [req.user.id]
  );
  if (rows.length === 0) return fail(res, 'User not found', 404);
  return ok(res, rows[0]);
});

// POST /api/auth/logout - JWT is stateless, parity endpoint only.
exports.logout = function (_req, res) {
  return ok(res, null, 'Logged out');
};

// POST /api/auth/forgot-password - { email }
// Always returns 200 so callers can't enumerate which emails are registered.
// If the email matches an active user, we mint a token and email them a link.
exports.forgotPassword = asyncHandler(async function (req, res) {
  const email = String((req.body || {}).email || '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    return fail(res, 'A valid email is required', 422);
  }
  const rows = await query(
    'SELECT id, name, lname, email, status, trash FROM `users` ' +
    ' WHERE email = ? AND trash = 0 AND status = 1 LIMIT 1',
    [email]
  );
  if (rows.length > 0) {
    const u = rows[0];
    const token = await issueToken(u.id, 'reset');
    mailer.passwordResetRequested({
      to: u.email,
      name: [u.name, u.lname].filter(Boolean).join(' '),
      resetToken: token,
    });
  }
  // Same response either way.
  return ok(res, null, 'If that email is on file, a reset link has been sent.');
});

// POST /api/auth/reset-password - { token, password }
// Consumes the token, sets the new password, clears any lockout.
exports.resetPassword = asyncHandler(async function (req, res) {
  const token = String((req.body || {}).token || '').trim();
  const password = String((req.body || {}).password || '');
  if (!token)                return fail(res, 'token is required', 422);
  if (password.length < 6)   return fail(res, 'Password must be at least 6 characters', 422);

  const row = await consumeToken(token);
  if (!row) return fail(res, 'This reset link is invalid or has expired', 400);

  const hash = await bcrypt.hash(password, 10);
  await execute(
    'UPDATE `users` ' +
    '   SET password = ?, login_attempts = 0, login_clear_datetime = NULL, ' +
    '       is_approved = 1 ' +
    ' WHERE id = ?',
    [hash, row.user_id]
  );
  await markUsed(row.id);
  return ok(res, null, 'Password updated. You can now sign in.');
});
