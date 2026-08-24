// Sites CRUD - tenant_admin (own tenant) or super_admin (any tenant via ?tenant_id=N).

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, effectiveTenantId, assertOwnership } = require('../../utils/tenantScope');
const { effectiveOrgId, scopeOrgWhere } = require('../../utils/orgScope');
const mailer = require('../../utils/mailer');
const { tenantAdminEmails, tenantName } = require('../../utils/mailRecipients');

exports.list = asyncHandler(async function (req, res) {
  // Real pagination + bounded LIMIT — the old version returned ALL sites
  // regardless of the caller's ?limit= (the list page set limit=20 but
  // got back every row). With 5-10 sites/tenant it didn't bite; once we
  // grow past that or super_admin views cross-tenant, it would.
  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['s.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('s.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('s.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  // Org scoping: super_admin/tenant_admin honour ?organisation_id=; org_admin
  // and below are hard-scoped to their own org.
  const orgScope = scopeOrgWhere(req, 's.organisation_id');
  if (orgScope.sql) {
    // strip leading ' AND ' for consistency with the string join here
    where.push(orgScope.sql.replace(/^\s*AND\s+/, ''));
    params.push(...orgScope.params);
  }

  // Free-text search across name, code, address. LIKE wildcards escaped.
  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const like = '%' + qRaw.replace(/[%_]/g, '\\$&') + '%';
    where.push('(s.name LIKE ? OR s.code LIKE ? OR s.address LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
console.log("where sql ", whereSql , "params : ", params)

  // TEMP DEBUG — prove which DB and which schema the running pool queries.
  const dbInfo = await query("SELECT DATABASE() AS db, @@port AS port, @@hostname AS host");
  console.log('[sites.list] runtime pool ->', dbInfo);
  const colInfo = await query("SHOW COLUMNS FROM `sites` LIKE 'organisation_id'");
  console.log('[sites.list] sites.organisation_id rows via pool ->', colInfo.length);

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `sites` s WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT s.id, s.tenant_id, s.organisation_id, s.name, s.code, s.address, s.timezone, s.status, s.created_at, ' +
    '       t.name AS tenant_name, o.name AS organisation_name ' +
    '  FROM `sites` s ' +
    '  LEFT JOIN `tenants` t ON t.id = s.tenant_id ' +
    '  LEFT JOIN `organisations` o ON o.id = s.organisation_id ' +
    ' WHERE ' + whereSql +
    ` ORDER BY s.id LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok(res, { data: rows, total: total, current_page: page, per_page: limit });
});

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'sites', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  return ok(res, r.row);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name) return fail(res, 'name is required', 422);

  let tenantId = effectiveTenantId(req, b.tenant_id);

  // organisation_id resolution:
  //   org_admin: server-forced from JWT (ignores any body override)
  //   super_admin / tenant_admin: uses body-provided organisation_id
  //   others: not reachable here (route is admin-gated)
  let organisationId = effectiveOrgId(req, b.organisation_id);

  // If tenantId wasn't provided (common when a super_admin doesn't send it
  // explicitly), derive it from the chosen organisation. This makes
  // organisation_id the single required parent field on the client.
  if (tenantId === null && organisationId !== null) {
    const orgRow = await query(
      'SELECT id, tenant_id FROM `organisations` WHERE id = ? AND trash = 0 LIMIT 1',
      [organisationId]
    );
    if (orgRow.length === 0) return fail(res, 'organisation_id is not valid', 422);
    tenantId = orgRow[0].tenant_id;
  }
  if (tenantId === null) return fail(res, 'tenant_id is required', 422);

  if (organisationId === null) {
    // Fall back to the tenant's Default org so pre-org clients keep working.
    const def = await query(
      "SELECT id FROM `organisations` WHERE tenant_id = ? AND slug = 'default' AND trash = 0 LIMIT 1",
      [tenantId]
    );
    if (def.length === 0) return fail(res, 'organisation_id is required (no default org for tenant)', 422);
    organisationId = def[0].id;
  }
  // Validate the chosen org actually belongs to this tenant.
  const orgCheck = await query(
    'SELECT id FROM `organisations` WHERE id = ? AND tenant_id = ? AND trash = 0 LIMIT 1',
    [organisationId, tenantId]
  );
  if (orgCheck.length === 0) return fail(res, 'organisation_id is not valid for this tenant', 422);

  const r = await execute(
    'INSERT INTO `sites` (tenant_id, organisation_id, name, code, address, timezone) VALUES (?, ?, ?, ?, ?, ?)',
    [tenantId, organisationId, b.name, b.code || null, b.address || null, b.timezone || null]
  );

  // Notify tenant admins (fire-and-forget). Wrapped in an async IIFE so the
  // request returns immediately even though we need two DB lookups first.
  (async () => {
    try {
      const [emails, tName] = await Promise.all([
        tenantAdminEmails(tenantId),
        tenantName(tenantId),
      ]);
      if (emails.length > 0) {
        mailer.siteCreated({
          to: emails,
          tenantName: tName || '',
          siteName: b.name,
          code: b.code || null,
          address: b.address || null,
        });
      }
    } catch (e) {
      console.error('[sites.create] notify failed:', e && e.message);
    }
  })();

  return created(res, { id: r.insertId }, 'Site created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'sites', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  // Extra guard for org-scoped roles: the site must belong to the caller's org.
  const role = req.user.role;
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    if (r.row.organisation_id !== req.user.organisation_id) {
      return fail(res, 'Forbidden', 403);
    }
  }

  const b = req.body || {};
  await execute(
    'UPDATE `sites` SET ' +
    '  name     = COALESCE(?, name), ' +
    '  code     = COALESCE(?, code), ' +
    '  address  = COALESCE(?, address), ' +
    '  timezone = COALESCE(?, timezone), ' +
    '  status   = COALESCE(?, status) ' +
    'WHERE id = ?',
    [b.name || null, b.code || null, b.address || null, b.timezone || null, intOrNull(b.status), id]
  );
  return ok(res, null, 'Site updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'sites', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  await execute('UPDATE `sites` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Site deleted');
});
