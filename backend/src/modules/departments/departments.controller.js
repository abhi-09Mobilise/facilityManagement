// Departments CRUD - tenant_admin (own tenant) or super_admin (any tenant).
//
// Departments are now scoped to a Site (migration 015 added the column).
// site_id is required on create; the form picks Site -> then Department
// cascade. The list endpoint accepts ?site_id= for the cascade fetch on
// the Employee create form.

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, effectiveTenantId, assertOwnership } = require('../../utils/tenantScope');
const mailer = require('../../utils/mailer');
const { userContact, tenantName } = require('../../utils/mailRecipients');

exports.list = asyncHandler(async function (req, res) {
  const where = ['d.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('d.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('d.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  // ?site_id= cascade filter (e.g. UserCreatePage loads depts after a site
  // is picked).
  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) { where.push('d.site_id = ?'); params.push(siteId); }

  // Free-text search across name + code. Departments are tiny (5-10 per
  // tenant) so no LIMIT/OFFSET needed — the SearchInput on the list page
  // narrows the visible rows even when the array is small.
  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const like = '%' + qRaw.replace(/[%_]/g, '\\$&') + '%';
    where.push('(d.name LIKE ? OR d.code LIKE ?)');
    params.push(like, like);
  }

  // ?parent_dept_id= retained for completeness even though the UI no longer
  // surfaces it. Backwards-compatible with any client still using it.
  if (Object.prototype.hasOwnProperty.call(req.query, 'parent_dept_id')) {
    const raw = req.query.parent_dept_id;
    if (raw === '' || raw === 'null') {
      where.push('d.parent_dept_id IS NULL');
    } else {
      const pid = intOrNull(raw);
      if (pid !== null) { where.push('d.parent_dept_id = ?'); params.push(pid); }
    }
  }

  const rows = await query(
    'SELECT d.id, d.tenant_id, d.site_id, d.name, d.code, d.parent_dept_id, ' +
    '       d.manager_user_id, d.status, ' +
    '       s.name AS site_name, ' +
    '       p.name AS parent_dept_name, ' +
    '       u.name AS manager_name, u.lname AS manager_lname ' +
    '  FROM `departments` d ' +
    '  LEFT JOIN `sites`       s ON s.id = d.site_id ' +
    '  LEFT JOIN `departments` p ON p.id = d.parent_dept_id ' +
    '  LEFT JOIN `users`       u ON u.id = d.manager_user_id ' +
    ' WHERE ' + where.join(' AND ') +
    ' ORDER BY s.name, d.name',
    params
  );
  return ok(res, rows);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name)    return fail(res, 'name is required', 422);
  if (!b.site_id) return fail(res, 'site_id is required (department must belong to a site)', 422);

  const tenantId = effectiveTenantId(req, b.tenant_id);
  if (tenantId === null) return fail(res, 'tenant_id is required', 422);

  // Site must exist + belong to this tenant.
  const site = await assertOwnership(req, 'sites', intOrNull(b.site_id));
  if (!site.ok) return fail(res, site.msg, site.status);
  if (site.row.tenant_id !== tenantId) {
    return fail(res, 'site_id is not valid for this tenant', 422);
  }

  // Parent department is optional (and the UI no longer exposes it).
  const parentId = intOrNull(b.parent_dept_id);
  if (parentId !== null) {
    const p = await assertOwnership(req, 'departments', parentId);
    if (!p.ok || p.row.tenant_id !== tenantId) {
      return fail(res, 'parent_dept_id is not valid for this tenant', 422);
    }
  }

  if (b.manager_user_id) {
    const mgr = await query('SELECT id, tenant_id FROM `users` WHERE id = ? LIMIT 1', [intOrNull(b.manager_user_id)]);
    if (mgr.length === 0 || mgr[0].tenant_id !== tenantId) {
      return fail(res, 'manager_user_id is not valid for this tenant', 422);
    }
  }

  const r = await execute(
    'INSERT INTO `departments` (tenant_id, site_id, name, code, parent_dept_id, manager_user_id) ' +
    'VALUES (?, ?, ?, ?, ?, ?)',
    [
      tenantId,
      site.row.id,
      b.name, b.code || null,
      parentId, intOrNull(b.manager_user_id),
    ]
  );

  const managerId = intOrNull(b.manager_user_id);
  if (managerId) {
    (async () => {
      try {
        const [mgr, tName] = await Promise.all([
          userContact(managerId),
          tenantName(tenantId),
        ]);
        if (mgr && mgr.email) {
          mailer.departmentCreated({
            to: mgr.email,
            tenantName: tName || '',
            deptName: b.name,
            managerName: mgr.name,
          });
        }
      } catch (e) {
        console.error('[departments.create] notify failed:', e && e.message);
      }
    })();
  }

  return created(res, { id: r.insertId }, 'Department created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'departments', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const b = req.body || {};

  // Allow moving a department to a different site, but it must belong to
  // the same tenant.
  let newSiteId = null;
  if (b.site_id !== undefined && b.site_id !== null && b.site_id !== '') {
    const site = await assertOwnership(req, 'sites', intOrNull(b.site_id));
    if (!site.ok || site.row.tenant_id !== r.row.tenant_id) {
      return fail(res, 'site_id is not valid for this tenant', 422);
    }
    newSiteId = site.row.id;
  }

  const parentId = intOrNull(b.parent_dept_id);
  if (parentId !== null) {
    if (parentId === id) return fail(res, 'A department cannot be its own parent', 422);
    const p = await assertOwnership(req, 'departments', parentId);
    if (!p.ok || p.row.tenant_id !== r.row.tenant_id) {
      return fail(res, 'parent_dept_id is not valid for this tenant', 422);
    }
  }

  await execute(
    'UPDATE `departments` SET ' +
    '  name            = COALESCE(?, name), ' +
    '  code            = COALESCE(?, code), ' +
    '  site_id         = COALESCE(?, site_id), ' +
    '  parent_dept_id  = COALESCE(?, parent_dept_id), ' +
    '  manager_user_id = COALESCE(?, manager_user_id), ' +
    '  status          = COALESCE(?, status) ' +
    'WHERE id = ?',
    [
      b.name || null, b.code || null,
      newSiteId,
      parentId, intOrNull(b.manager_user_id),
      intOrNull(b.status), id,
    ]
  );
  return ok(res, null, 'Department updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'departments', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  await execute('UPDATE `departments` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Department deleted');
});
