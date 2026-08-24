// Buildings — the layer between Site and Floor (introduced Phase A of the
// hierarchy rollout after Organisations).
//
// Every site auto-gets a "Default" building via migration 042 so pre-existing
// floors keep working. Admins can then split off named buildings and reparent
// floors as needed.
//
// Org scoping: a building inherits its org from its parent site (there is no
// separate write-path for organisation_id on the API — the controller reads it
// off the site at create time). This keeps FK consistency guaranteed.

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, assertOwnership } = require('../../utils/tenantScope');
const { scopeOrgWhere, effectiveOrgId, assertOrgScope } = require('../../utils/orgScope');

exports.list = asyncHandler(async function (req, res) {
  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['b.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('b.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('b.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  // Org scoping — super_admin / tenant_admin honour ?organisation_id=;
  // org_admin and below are hard-scoped to their own org.
  const orgScope = scopeOrgWhere(req, 'b.organisation_id');
  if (orgScope.sql) {
    where.push(orgScope.sql.replace(/^\s*AND\s+/, ''));
    params.push(...orgScope.params);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) { where.push('b.site_id = ?'); params.push(siteId); }

  // Free-text search across name, code, address. LIKE wildcards escaped.
  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const like = '%' + qRaw.replace(/[%_]/g, '\\$&') + '%';
    where.push('(b.name LIKE ? OR b.code LIKE ? OR b.address LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `buildings` b WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT b.id, b.tenant_id, b.organisation_id, b.site_id, b.name, b.code, b.address, b.status, b.created_at, ' +
    '       t.name AS tenant_name, s.name AS site_name, o.name AS organisation_name ' +
    '  FROM `buildings` b ' +
    '  LEFT JOIN `tenants`       t ON t.id = b.tenant_id ' +
    '  LEFT JOIN `sites`         s ON s.id = b.site_id ' +
    '  LEFT JOIN `organisations` o ON o.id = b.organisation_id ' +
    ' WHERE ' + whereSql +
    ` ORDER BY b.id LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok(res, { data: rows, total: total, current_page: page, per_page: limit });
});

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'buildings', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  // Extra guard for org-scoped roles: the building must belong to caller's org.
  const role = req.user.role;
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    if (r.row.organisation_id !== req.user.organisation_id) {
      return fail(res, 'Forbidden', 403);
    }
  }
  return ok(res, r.row);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name)    return fail(res, 'name is required', 422);
  if (!b.site_id) return fail(res, 'site_id is required', 422);

  // Load and validate parent site: caller must own it (tenant scope), and
  // for org-scoped roles the site must belong to caller's org.
  const site = await assertOwnership(req, 'sites', intOrNull(b.site_id));
  if (!site.ok) return fail(res, site.msg, site.status);

  const role = req.user.role;
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    if (site.row.organisation_id !== req.user.organisation_id) {
      return fail(res, 'Forbidden: site belongs to a different organisation', 403);
    }
  }

  // Derive tenant_id + organisation_id from the parent site — a building's
  // org MUST match its site's org, so we never trust body-provided values.
  const tenantId       = site.row.tenant_id;
  const organisationId = site.row.organisation_id;

  // Belt-and-braces: make sure effectiveOrgId agrees for org-scoped callers
  // (protects against a mis-signed JWT sneaking through). No-op for admins.
  const callerOrg = effectiveOrgId(req, b.organisation_id);
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    if (callerOrg !== organisationId) {
      return fail(res, 'Forbidden: site belongs to a different organisation', 403);
    }
  }

  const r = await execute(
    'INSERT INTO `buildings` (tenant_id, organisation_id, site_id, name, code, address) VALUES (?, ?, ?, ?, ?, ?)',
    [tenantId, organisationId, site.row.id, b.name, b.code || null, b.address || null]
  );

  return created(res, { id: r.insertId }, 'Building created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'buildings', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  // Extra guard for org-scoped roles: the building must belong to caller's org.
  const role = req.user.role;
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    if (r.row.organisation_id !== req.user.organisation_id) {
      return fail(res, 'Forbidden', 403);
    }
  }

  const b = req.body || {};
  await execute(
    'UPDATE `buildings` SET ' +
    '  name    = COALESCE(?, name), ' +
    '  code    = COALESCE(?, code), ' +
    '  address = COALESCE(?, address), ' +
    '  status  = COALESCE(?, status) ' +
    'WHERE id = ?',
    [b.name || null, b.code || null, b.address || null, intOrNull(b.status), id]
  );
  return ok(res, null, 'Building updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'buildings', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  // Block if any live (trash=0) floors still reference this building.
  // 043 also enforces this at the FK layer via ON DELETE RESTRICT, but a
  // soft-delete never hits that check — so we do it in app code too and
  // return a friendlier message.
  const usage = await query(
    'SELECT COUNT(*) AS cnt FROM `floors` WHERE building_id = ? AND trash = 0',
    [id]
  );
  const floorCount = usage[0] ? usage[0].cnt : 0;
  if (floorCount > 0) {
    return fail(
      res,
      'Cannot delete: this building has ' + floorCount + ' floor(s). Move or delete those first.',
      409
    );
  }

  await execute('UPDATE `buildings` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Building deleted');
});

// assertOrgScope is imported for symmetry with the rest of the org-scoped
// modules — future building-level sub-routes (e.g. per-building admins) will
// reach for it. Kept in the import list intentionally.
if (false) { void assertOrgScope; } // eslint-disable-line no-constant-condition
