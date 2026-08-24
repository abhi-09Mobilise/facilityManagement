// Organisations CRUD + admin membership.
//
// The Org layer sits between Tenant and Site (introduced by migrations
// 035-039). This controller powers /api/organisations:
//   - list/getOne visibility depends on caller role (see per-handler notes)
//   - create / delete are limited to tenant_admin + super_admin (org_admins
//     cannot spawn or destroy sibling orgs)
//   - update lets an org_admin edit their own org's name + logo, nothing else
//   - listAdmins / addAdmin / removeAdmin manage the users.role='org_admin'
//     assignments within a specific org

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, execute, withTransaction } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');
const { issueToken } = require('../../utils/passwordResetTokens');
const mailer = require('../../utils/mailer');
const { tenantName } = require('../../utils/mailRecipients');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Slug rule: lowercase, non-alphanumerics collapsed to a single hyphen,
// trimmed. If empty (name was e.g. "!!!"), fall back to "org".
function slugify(str) {
  const base = String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'org';
}

// Find a slug that doesn't collide with (tenant_id, slug) uniqueness.
// Appends -2, -3, ... until it clears.
async function uniqueSlug(tenantId, desired) {
  let candidate = desired;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await query(
      'SELECT id FROM `organisations` WHERE tenant_id = ? AND slug = ? LIMIT 1',
      [tenantId, candidate]
    );
    if (rows.length === 0) return candidate;
    candidate = desired + '-' + n;
    n += 1;
    if (n > 500) return candidate; // paranoia break-out
  }
}

// ---------- list -------------------------------------------------------

exports.list = asyncHandler(async function (req, res) {
  const role = req.user.role;
  if (role === 'employee' || role === 'approver') {
    return fail(res, 'Forbidden', 403);
  }

  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['o.trash = 0'];
  const params = [];

  if (role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('o.tenant_id = ?'); params.push(tid); }
  } else if (role === 'tenant_admin') {
    where.push('o.tenant_id = ?');
    params.push(req.user.tenant_id);
  } else {
    // org_admin: single-row view of just their own org
    where.push('o.tenant_id = ?');
    params.push(req.user.tenant_id);
    where.push('o.id = ?');
    params.push(req.user.organisation_id || 0);
  }

  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const like = '%' + qRaw.replace(/[%_]/g, '\\$&') + '%';
    where.push('(o.name LIKE ? OR o.slug LIKE ?)');
    params.push(like, like);
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `organisations` o WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT o.id, o.tenant_id, o.name, o.slug, o.logo_url, o.status, o.created_at, ' +
    '       t.name AS tenant_name ' +
    '  FROM `organisations` o ' +
    '  LEFT JOIN `tenants` t ON t.id = o.tenant_id ' +
    ' WHERE ' + whereSql +
    ' ORDER BY o.id ' +
    ' LIMIT ' + limit + ' OFFSET ' + offset,
    params
  );

  return ok(res, { data: rows, total: total, current_page: page, per_page: limit });
});

// ---------- getOne -----------------------------------------------------

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const rows = await query(
    'SELECT o.id, o.tenant_id, o.name, o.slug, o.logo_url, o.status, o.created_at, ' +
    '       t.name AS tenant_name ' +
    '  FROM `organisations` o ' +
    '  LEFT JOIN `tenants` t ON t.id = o.tenant_id ' +
    ' WHERE o.id = ? AND o.trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return fail(res, 'Organisation not found', 404);
  const row = rows[0];

  const role = req.user.role;
  if (role === 'super_admin') {
    // no additional constraint
  } else if (role === 'tenant_admin') {
    if (row.tenant_id !== req.user.tenant_id) return fail(res, 'Forbidden', 403);
  } else {
    // org_admin / approver / employee — must be their own org
    if (row.tenant_id !== req.user.tenant_id) return fail(res, 'Forbidden', 403);
    if (row.id !== (req.user.organisation_id || null)) return fail(res, 'Forbidden', 403);
  }
  return ok(res, row);
});

// ---------- create -----------------------------------------------------

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return fail(res, 'name is required', 422);

  // tenant_id: super_admin picks; tenant_admin is forced to their own.
  let tenantId;
  if (req.user.role === 'super_admin') {
    tenantId = intOrNull(b.tenant_id);
    if (tenantId === null) return fail(res, 'tenant_id is required', 422);
    const t = await query('SELECT id FROM `tenants` WHERE id = ? AND trash = 0 LIMIT 1', [tenantId]);
    if (t.length === 0) return fail(res, 'tenant_id is not valid', 422);
  } else {
    tenantId = req.user.tenant_id;
    if (!tenantId) return fail(res, 'Caller has no tenant', 400);
  }

  const desiredSlug = slugify(b.slug || name);
  const slug = await uniqueSlug(tenantId, desiredSlug);

  const logoUrl = (typeof b.logo_url === 'string' && b.logo_url.trim())
    ? b.logo_url.trim()
    : null;

  // Stage-3: optional first org_admin user paired with the invite email.
  const adminEmail    = (b.admin_email || '').trim();
  const adminName     = (b.admin_name || '').trim();
  const adminLname    = (b.admin_lname || '').trim();
  const sendInvite    = b.send_invite === undefined ? true : Boolean(b.send_invite);
  const adminUsername = (b.admin_username || '').trim() || (slug + 'admin');
  const adminPassword = (b.admin_password || '').toString();

  if (adminEmail && !EMAIL_RE.test(adminEmail)) {
    return fail(res, 'admin_email is not valid', 422);
  }

  // Hash the password once, outside the txn — bcrypt is CPU-bound and we want
  // to keep the InnoDB transaction as short as possible.
  const rawPassword = adminPassword || crypto.randomBytes(32).toString('hex');
  const passwordHash = adminEmail ? await bcrypt.hash(rawPassword, 10) : null;

  const txResult = await withTransaction(async function (conn) {
    // 1. Organisation row (existing insert).
    const [orgR] = await conn.execute(
      'INSERT INTO `organisations` (tenant_id, name, slug, logo_url, status, trash) ' +
      'VALUES (?, ?, ?, ?, 1, 0)',
      [tenantId, name, slug, logoUrl]
    );
    const orgId = orgR.insertId;

    // 2. Optional first org_admin user.
    let adminUserId = null;
    if (adminEmail) {
      const [ur] = await conn.execute(
        'INSERT INTO `users` ' +
        '   (tenant_id, organisation_id, username, password, name, lname, email, ' +
        "    role, status, is_approved, is_approver, trash) " +
        " VALUES (?, ?, ?, ?, ?, ?, ?, 'org_admin', 1, 1, 1, 0)",
        [
          tenantId, orgId, adminUsername, passwordHash,
          adminName || null, adminLname || null, adminEmail,
        ]
      );
      adminUserId = ur.insertId;
    }

    return { orgId, adminUserId };
  });

  // Fire-and-forget: invite email for the new org_admin. Failure to send must
  // never roll back the org row, so we mint the token + send AFTER commit.
  if (adminEmail && sendInvite && txResult.adminUserId) {
    (async () => {
      try {
        const token = await issueToken(txResult.adminUserId, 'invite');
        const tName = await tenantName(tenantId);
        mailer.userInvited({
          to: adminEmail,
          name: [adminName, adminLname].filter(Boolean).join(' ') || null,
          username: adminUsername,
          tenantName: tName || '',
          resetToken: token,
        });
      } catch (e) {
        console.error('[organisations.create] invite mail failed:', e && e.message);
      }
    })();
  }

  return created(
    res,
    {
      id: txResult.orgId,
      admin_user_id: txResult.adminUserId,
      admin_username: txResult.adminUserId ? adminUsername : null,
    },
    adminEmail && sendInvite
      ? 'Organisation created; invite email sent'
      : 'Organisation created'
  );
});

// ---------- update -----------------------------------------------------

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const rows = await query(
    'SELECT id, tenant_id, name, slug FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return fail(res, 'Organisation not found', 404);
  const target = rows[0];

  const role = req.user.role;

  // RBAC:
  //   - super_admin: any org
  //   - tenant_admin: any org in their tenant
  //   - org_admin: only their OWN org, and only name/logo/status (never slug/tenant)
  //   - others: forbidden
  if (role === 'super_admin') {
    // ok
  } else if (role === 'tenant_admin') {
    if (target.tenant_id !== req.user.tenant_id) return fail(res, 'Forbidden', 403);
  } else if (role === 'org_admin') {
    if (target.tenant_id !== req.user.tenant_id) return fail(res, 'Forbidden', 403);
    if (target.id !== (req.user.organisation_id || null)) return fail(res, 'Forbidden', 403);
  } else {
    return fail(res, 'Forbidden', 403);
  }

  const b = req.body || {};

  // Slug edits: only super_admin + tenant_admin. Skip if unchanged; re-validate
  // uniqueness within the tenant otherwise.
  let newSlug = null;
  if (b.slug !== undefined && b.slug !== null && String(b.slug).trim() !== '') {
    if (role === 'org_admin') {
      return fail(res, 'org_admin cannot change slug', 403);
    }
    const desired = slugify(b.slug);
    if (desired !== target.slug) {
      newSlug = await uniqueSlug(target.tenant_id, desired);
    }
  }

  const logoPatched = Object.prototype.hasOwnProperty.call(b, 'logo_url');
  const logoValue = logoPatched
    ? (b.logo_url ? String(b.logo_url).trim() : null)
    : null;

  await execute(
    'UPDATE `organisations` SET ' +
    '  name     = COALESCE(?, name), ' +
    '  slug     = COALESCE(?, slug), ' +
    '  logo_url = ' + (logoPatched ? '?' : 'logo_url') + ', ' +
    '  status   = COALESCE(?, status) ' +
    'WHERE id = ?',
    [
      b.name ? String(b.name).trim() : null,
      newSlug,
      ...(logoPatched ? [logoValue] : []),
      intOrNull(b.status),
      id,
    ]
  );
  return ok(res, null, 'Organisation updated');
});

// ---------- remove -----------------------------------------------------

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const rows = await query(
    'SELECT id, tenant_id FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return fail(res, 'Organisation not found', 404);
  const target = rows[0];

  if (req.user.role !== 'super_admin' && target.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  // Block delete when live sites or departments still point at this org.
  // Users are allowed (FK is ON DELETE SET NULL) but we still warn about
  // sites/departments (FK is ON DELETE RESTRICT).
  const siteCntRow = (await query(
    'SELECT COUNT(*) AS cnt FROM `sites` WHERE organisation_id = ? AND trash = 0',
    [id]
  ))[0];
  const deptCntRow = (await query(
    'SELECT COUNT(*) AS cnt FROM `departments` WHERE organisation_id = ? AND trash = 0',
    [id]
  ))[0];
  const nSites = Number(siteCntRow.cnt || 0);
  const nDepts = Number(deptCntRow.cnt || 0);
  if (nSites > 0 || nDepts > 0) {
    return fail(
      res,
      'Cannot delete: this organisation has ' + nSites + ' sites and ' + nDepts +
      ' departments. Move or delete those first.',
      409
    );
  }

  await execute('UPDATE `organisations` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Organisation deleted');
});

// ---------- admins: list / add / remove --------------------------------

async function loadOrgOr403(req, id) {
  const rows = await query(
    'SELECT id, tenant_id FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return { ok: false, status: 404, msg: 'Organisation not found' };
  const org = rows[0];
  const role = req.user.role;
  if (role === 'super_admin') return { ok: true, org };
  if (role === 'tenant_admin') {
    if (org.tenant_id !== req.user.tenant_id) return { ok: false, status: 403, msg: 'Forbidden' };
    return { ok: true, org };
  }
  if (role === 'org_admin') {
    if (org.tenant_id !== req.user.tenant_id) return { ok: false, status: 403, msg: 'Forbidden' };
    if (org.id !== (req.user.organisation_id || null)) return { ok: false, status: 403, msg: 'Forbidden' };
    return { ok: true, org };
  }
  return { ok: false, status: 403, msg: 'Forbidden' };
}

exports.listAdmins = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const g = await loadOrgOr403(req, id);
  if (!g.ok) return fail(res, g.msg, g.status);

  const rows = await query(
    'SELECT u.id, u.username, u.name, u.lname, u.email, u.mobile, u.designation, ' +
    '       u.role, u.status, u.is_approver, u.created_at ' +
    '  FROM `users` u ' +
    " WHERE u.role = 'org_admin' AND u.organisation_id = ? AND u.trash = 0 " +
    ' ORDER BY u.name, u.lname, u.username',
    [id]
  );
  return ok(res, rows);
});

exports.addAdmin = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  // Org existence + tenant scope check (super_admin bypass tenant scope).
  const orgRows = await query(
    'SELECT id, tenant_id FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (orgRows.length === 0) return fail(res, 'Organisation not found', 404);
  const org = orgRows[0];
  if (req.user.role !== 'super_admin' && org.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  const b = req.body || {};
  const userId = intOrNull(b.user_id);
  if (userId === null) return fail(res, 'user_id is required', 422);

  const uRows = await query(
    'SELECT id, tenant_id, role FROM `users` WHERE id = ? AND trash = 0 LIMIT 1',
    [userId]
  );
  if (uRows.length === 0) return fail(res, 'User not found', 404);
  const u = uRows[0];
  if (u.tenant_id !== org.tenant_id) {
    return fail(res, 'User belongs to a different tenant', 422);
  }

  await execute(
    "UPDATE `users` SET role = 'org_admin', organisation_id = ?, is_approver = 1 WHERE id = ?",
    [id, userId]
  );
  return ok(res, null, 'Org admin assigned');
});

exports.removeAdmin = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  const userId = intOrNull(req.params.userId);
  if (id === null || userId === null) return fail(res, 'Invalid id', 400);

  const orgRows = await query(
    'SELECT id, tenant_id FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
    [id]
  );
  if (orgRows.length === 0) return fail(res, 'Organisation not found', 404);
  const org = orgRows[0];
  if (req.user.role !== 'super_admin' && org.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }

  const uRows = await query(
    'SELECT id, tenant_id, role, organisation_id FROM `users` WHERE id = ? AND trash = 0 LIMIT 1',
    [userId]
  );
  if (uRows.length === 0) return fail(res, 'User not found', 404);
  const u = uRows[0];
  if (u.role !== 'org_admin' || u.organisation_id !== id) {
    return fail(res, 'User is not an admin of this organisation', 422);
  }

  // Demote to employee. Keep organisation_id so the user still belongs
  // somewhere sensible after the demotion.
  await execute(
    "UPDATE `users` SET role = 'employee', is_approver = 0 WHERE id = ?",
    [userId]
  );
  return ok(res, null, 'Org admin removed');
});
