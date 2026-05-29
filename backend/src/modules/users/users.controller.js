// Users CRUD - admin endpoints.

const bcrypt = require('bcryptjs');
const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { issueToken } = require('../../utils/passwordResetTokens');
const mailer = require('../../utils/mailer');
const { tenantName } = require('../../utils/mailRecipients');

const intOrNull = (v) =>
  (v === undefined || v === null || v === '') ? null
    : (Number.isNaN(parseInt(v, 10)) ? null : parseInt(v, 10));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Role catalog (kept in one place). After migration 020 the enum is:
//   super_admin | tenant_admin | approver | employee
const VALID_ROLES = ['super_admin', 'tenant_admin', 'approver', 'employee'];
const TENANT_ADMIN_ASSIGNABLE = ['employee', 'approver'];

function effectiveTenantId(req, fallback) {
  if (req.user.role === 'super_admin') {
    return intOrNull(fallback) !== null ? intOrNull(fallback) : null;
  }
  return req.user.tenant_id;
}

async function ensureTenantBelongs(table, id, tenantId) {
  if (id === null) return null;
  const rows = await query(
    `SELECT tenant_id FROM \`${table}\` WHERE id = ? AND trash = 0 LIMIT 1`,
    [id]
  );
  if (rows.length === 0) return `${table.slice(0, -1)} not found`;
  if (rows[0].tenant_id !== tenantId) return `${table.slice(0, -1)} belongs to a different tenant`;
  return null;
}

// ---------- list -------------------------------------------------------

exports.list = asyncHandler(async function (req, res) {
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
  const page   = Math.max(1, parseInt(req.query.page || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['u.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('u.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('u.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  if (req.query.q) {
    where.push('(u.username LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    const like = '%' + req.query.q + '%';
    params.push(like, like, like);
  }
  // Optional exact-match filters used by pickers (e.g. the Department form
  // wants only users whose designation is 'Manager').
  if (req.query.designation) {
    where.push('u.designation = ?');
    params.push(String(req.query.designation));
  }
  if (req.query.role) {
    where.push('u.role = ?');
    params.push(String(req.query.role));
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `users` u WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT u.id, u.tenant_id, u.username, u.name, u.lname, u.email, u.mobile, ' +
    '       u.designation, u.role, u.status, u.is_approved, u.is_approver, u.created_at, ' +
    '       u.department_id, u.site_id, ' +
    '       d.name AS department_name, s.name AS site_name ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `departments` d ON d.id = u.department_id ' +
    '  LEFT JOIN `sites`       s ON s.id = u.site_id ' +
    ' WHERE ' + whereSql +
    ' ORDER BY u.id DESC ' +
    ` LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok(res, { data: rows, total, current_page: page, per_page: limit });
});

// ---------- create -----------------------------------------------------

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  const username = (b.username || '').trim();
  const password = b.password || '';

  if (!username) return fail(res, 'Username is required', 422);
  if (!password || password.length < 6) return fail(res, 'Password must be at least 6 characters', 422);
  if (b.email && !EMAIL_RE.test(b.email)) return fail(res, 'Email is not valid', 422);

  const tenantId = effectiveTenantId(req, b.tenant_id);
  if (tenantId === null && req.user.role !== 'super_admin') {
    return fail(res, 'tenant_id is required', 422);
  }

  const requestedRole = b.role || 'employee';
  if (!VALID_ROLES.includes(requestedRole)) {
    return fail(res, 'role must be one of: ' + VALID_ROLES.join(', '), 422);
  }
  if (req.user.role !== 'super_admin' && !TENANT_ADMIN_ASSIGNABLE.includes(requestedRole)) {
    return fail(res, 'Only super admins can create ' + requestedRole + ' users', 403);
  }
  // Promoting to 'approver' implies the is_approver flag (used by chain-step
  // approver-eligibility queries). Keep the column mirrored for backwards
  // compatibility.
  const isApproverFlag = requestedRole === 'approver' ? 1 : (b.is_approver ? 1 : 0);

  // Validate department + site belong to the same tenant
  const deptId = intOrNull(b.department_id);
  const siteId = intOrNull(b.site_id);
  if (deptId !== null) {
    const err = await ensureTenantBelongs('departments', deptId, tenantId);
    if (err) return fail(res, err, 422);
  }
  if (siteId !== null) {
    const err = await ensureTenantBelongs('sites', siteId, tenantId);
    if (err) return fail(res, err, 422);
  }

  const existing = await query(
    "SELECT id FROM `users` WHERE (username = ? OR designation = 'Manager') " +
    "  AND tenant_id = ? AND department_id = ? AND site_id = ? LIMIT 1",
    [username, tenantId, deptId, siteId]
  );
  if (existing.length > 0) return fail(res, 'Username or Manager Already Exist', 409);

  const hash = await bcrypt.hash(password, 10);
  const r = await execute(
    'INSERT INTO `users` ' +
    '   (tenant_id, department_id, site_id, username, password, name, lname, email, mobile, ' +
    '    designation, role, status, is_approved, is_approver, trash) ' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    [
      tenantId, deptId, siteId,
      username, hash,
      b.name || null, b.lname || null,
      b.email || null, b.mobile || null,
      b.designation || null,
      requestedRole,
      b.status === 0 || b.status === '0' ? 0 : 1,
      b.is_approved === 0 || b.is_approved === '0' ? 0 : 1,
      isApproverFlag,
    ]
  );

  // Invite email: mint a one-time token and let the user set their own
  // password via /reset-password. Fire-and-forget.
  if (b.email) {
    (async () => {
      try {
        const token = await issueToken(r.insertId, 'invite');
        const tName = await tenantName(tenantId);
        mailer.userInvited({
          to: b.email,
          name: [b.name, b.lname].filter(Boolean).join(' ') || null,
          username,
          tenantName: tName || '',
          resetToken: token,
        });
      } catch (e) {
        console.error('[users.create] invite mail failed:', e && e.message);
      }
    })();
  }

  return created(res, { id: r.insertId }, 'User created');
});

// ---------- update -----------------------------------------------------

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull((req.body || {}).id);
  if (id === null) return fail(res, 'id is required', 422);
  const b = req.body || {};

  if (b.email && !EMAIL_RE.test(b.email)) return fail(res, 'Email is not valid', 422);

  const target = (await query(
    'SELECT id, tenant_id, role FROM `users` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  ))[0];
  if (!target) return fail(res, 'User not found', 404);

  if (req.user.role !== 'super_admin' && target.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  if (req.user.role !== 'super_admin' && !TENANT_ADMIN_ASSIGNABLE.includes(target.role)) {
    return fail(res, 'Only super admins can modify admins', 403);
  }

  // Optional role change.
  let newRole = null;
  if (b.role && b.role !== target.role) {
    if (!VALID_ROLES.includes(b.role)) {
      return fail(res, 'role must be one of: ' + VALID_ROLES.join(', '), 422);
    }
    if (req.user.role !== 'super_admin' && !TENANT_ADMIN_ASSIGNABLE.includes(b.role)) {
      return fail(res, 'Only super admins can assign ' + b.role + ' role', 403);
    }
    newRole = b.role;
  }
  // Mirror is_approver from effective role (null = leave alone).
  const effectiveRole = newRole || target.role;
  const isApproverPatch = effectiveRole === 'approver' ? 1 : intOrNull(b.is_approver);

  const deptId = intOrNull(b.department_id);
  const siteId = intOrNull(b.site_id);
  if (deptId !== null) {
    const err = await ensureTenantBelongs('departments', deptId, target.tenant_id);
    if (err) return fail(res, err, 422);
  }
  if (siteId !== null) {
    const err = await ensureTenantBelongs('sites', siteId, target.tenant_id);
    if (err) return fail(res, err, 422);
  }

  await execute(
    'UPDATE `users` ' +
    '   SET name          = COALESCE(?, name), ' +
    '       lname         = COALESCE(?, lname), ' +
    '       email         = COALESCE(?, email), ' +
    '       mobile        = COALESCE(?, mobile), ' +
    '       designation   = COALESCE(?, designation), ' +
    '       department_id = COALESCE(?, department_id), ' +
    '       site_id       = COALESCE(?, site_id), ' +
    '       role          = COALESCE(?, role), ' +
    '       status        = COALESCE(?, status), ' +
    '       is_approved   = COALESCE(?, is_approved), ' +
    '       is_approver   = COALESCE(?, is_approver) ' +
    ' WHERE id = ?',
    [
      b.name || null, b.lname || null, b.email || null, b.mobile || null,
      b.designation || null,
      deptId, siteId,
      newRole,
      intOrNull(b.status), intOrNull(b.is_approved), isApproverPatch,
      id,
    ]
  );
  return ok(res, null, 'User updated');
});

// ---------- getOne -----------------------------------------------------

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const rows = await query(
    'SELECT u.id, u.tenant_id, u.department_id, u.site_id, u.username, u.name, u.lname, ' +
    '       u.email, u.mobile, u.designation, u.role, u.status, u.is_approved, u.is_approver, u.created_at, ' +
    '       d.name AS department_name, s.name AS site_name ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `departments` d ON d.id = u.department_id ' +
    '  LEFT JOIN `sites`       s ON s.id = u.site_id ' +
    ' WHERE u.id = ? AND u.trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return fail(res, 'User not found', 404);
  const row = rows[0];

  if (req.user.role !== 'super_admin' && row.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  return ok(res, row);
});

// ---------- approvers (used by chain step picker) ----------------------

exports.approvers = asyncHandler(async function (req, res) {
  // u.* lives behind an alias here so the optional ?site_id= / ?department_id=
  // filters can sit next to the joined department row.
  const where = ['u.trash = 0', 'u.status = 1', 'u.is_approver = 1'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('u.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('u.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  // Optional cascade filters used by the per-facility chain editor:
  //   ?site_id= ........ approvers belonging to a department in this site
  //   ?department_id= .. approvers belonging to one specific department
  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) { where.push('d.site_id = ?'); params.push(siteId); }
  const deptId = intOrNull(req.query.department_id);
  if (deptId !== null) { where.push('u.department_id = ?'); params.push(deptId); }

  const rows = await query(
    'SELECT u.id, u.username, u.name, u.lname, u.email, u.designation, u.role, ' +
    '       u.department_id, d.name AS department_name ' +
    '  FROM `users` u ' +
    '  LEFT JOIN `departments` d ON d.id = u.department_id ' +
    ' WHERE ' + where.join(' AND ') +
    ' ORDER BY u.name, u.lname, u.username',
    params
  );
  return ok(res, rows);
});

// ---------- me-summary (used by approver dashboard) --------------------
// Lightweight payload so the dashboard knows whether to show the "Team
// bookings" tab and what counts to badge in the nav.
exports.meSummary = asyncHandler(async function (req, res) {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  const [managedDeptsRows, pendingRows, historyRows] = await Promise.all([
    tenantId === null
      ? Promise.resolve([])
      : query(
          'SELECT id, name FROM `departments` ' +
          ' WHERE manager_user_id = ? AND tenant_id = ? AND trash = 0',
          [userId, tenantId]
        ),
    query(
      "SELECT COUNT(*) AS cnt FROM `booking_approvals` " +
      " WHERE approver_user_id = ? AND decision = 'pending'",
      [userId]
    ),
    query(
      "SELECT COUNT(*) AS cnt FROM `booking_approvals` " +
      " WHERE approver_user_id = ? AND decision != 'pending'",
      [userId]
    ),
  ]);

  return ok(res, {
    is_dept_manager: managedDeptsRows.length > 0,
    managed_dept_ids: managedDeptsRows.map((r) => r.id),
    managed_dept_names: managedDeptsRows.map((r) => r.name),
    pending_count: pendingRows[0].cnt,
    history_count: historyRows[0].cnt,
  });
});

// ---------- remove -----------------------------------------------------

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull((req.body || {}).id);
  if (id === null) return fail(res, 'id is required', 422);

  const target = (await query(
    'SELECT id, tenant_id, role FROM `users` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  ))[0];
  if (!target) return fail(res, 'User not found', 404);

  if (req.user.role !== 'super_admin' && target.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  if (req.user.role !== 'super_admin' && !TENANT_ADMIN_ASSIGNABLE.includes(target.role)) {
    return fail(res, 'Only super admins can delete admins', 403);
  }

  await execute('UPDATE `users` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'User deleted');
});
