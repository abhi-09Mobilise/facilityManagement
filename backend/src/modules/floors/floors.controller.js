// Floors CRUD - tenant_admin (own tenant) or super_admin (any tenant).
// Every floor belongs to a building (Phase A of the hierarchy rollout);
// the building's site is the source of truth for tenant_id + site_id, and
// the site's org is the source of truth for organisation_id.

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, assertOwnership } = require('../../utils/tenantScope');
const { scopeOrgWhere, assertOrgScope } = require('../../utils/orgScope');
const mailer = require('../../utils/mailer');
const { tenantAdminEmails, tenantName } = require('../../utils/mailRecipients');

exports.list = asyncHandler(async function (req, res) {
  const where = ['f.trash = 0'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('f.tenant_id = ?'); params.push(tid); }
  } else {
    where.push('f.tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  const siteId = intOrNull(req.query.site_id);
  if (siteId !== null) { where.push('f.site_id = ?'); params.push(siteId); }

  const buildingId = intOrNull(req.query.building_id);
  if (buildingId !== null) { where.push('f.building_id = ?'); params.push(buildingId); }

  // Org scoping — floors have no org column of their own, they inherit via
  // the parent site. scopeOrgWhere is safe to use on `s.organisation_id`.
  const orgScope = scopeOrgWhere(req, 's.organisation_id');
  if (orgScope.sql) {
    where.push(orgScope.sql.replace(/^\s*AND\s+/, ''));
    params.push(...orgScope.params);
  }

  const rows = await query(
    'SELECT f.id, f.tenant_id, f.site_id, f.building_id, s.organisation_id, ' +
    '       f.name, f.level_number, f.layout_image_url, f.status, f.created_at, ' +
    '       t.name AS tenant_name, s.name AS site_name, b.name AS building_name ' +
    '  FROM `floors` f ' +
    '  LEFT JOIN `tenants`   t ON t.id = f.tenant_id ' +
    '  LEFT JOIN `sites`     s ON s.id = f.site_id ' +
    '  LEFT JOIN `buildings` b ON b.id = f.building_id ' +
    ' WHERE ' + where.join(' AND ') +
    ' ORDER BY f.level_number, f.name',
    params
  );
  return ok(res, rows);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name)        return fail(res, 'name is required', 422);
  if (!b.building_id) return fail(res, 'building_id is required', 422);

  // Load and scope-check the parent building. assertOrgScope enforces the
  // org check for org-scoped roles; we then run assertOwnership to keep the
  // tenant check consistent with the rest of the module (super_admin
  // bypasses both, tenant_admin bypasses only the org check).
  const buildingId = intOrNull(b.building_id);
  const bScope = await assertOrgScope(req, 'buildings', buildingId);
  if (!bScope.ok) return fail(res, bScope.msg, bScope.status);
  const bOwn = await assertOwnership(req, 'buildings', buildingId);
  if (!bOwn.ok) return fail(res, bOwn.msg, bOwn.status);
  const building = bOwn.row;

  // Derive site_id + tenant_id + organisation_id from the building — never
  // trust body. Cross-parent moves happen through /update, not create.
  const site = (await query(
    'SELECT id, name, tenant_id, organisation_id FROM `sites` WHERE id = ? LIMIT 1',
    [building.site_id]
  ))[0];
  if (!site) return fail(res, 'Parent site not found for building', 400);

  // Cap the base64 layout image at ~2 MB raw text to stay under MEDIUMTEXT's
  // 16 MB ceiling and keep the floors.list payload sensible.
  const layoutImageUrl = (typeof b.layout_image_url === 'string' && b.layout_image_url.length > 0)
    ? (b.layout_image_url.length > 2 * 1024 * 1024 ? null : b.layout_image_url)
    : null;

  const r = await execute(
    'INSERT INTO `floors` (tenant_id, site_id, building_id, name, level_number, layout_image_url) VALUES (?, ?, ?, ?, ?, ?)',
    [building.tenant_id, site.id, building.id, b.name, intOrNull(b.level_number), layoutImageUrl]
  );

  // Notify tenant admins (fire-and-forget).
  (async () => {
    try {
      const [emails, tName] = await Promise.all([
        tenantAdminEmails(building.tenant_id),
        tenantName(building.tenant_id),
      ]);
      if (emails.length > 0) {
        mailer.floorCreated({
          to: emails,
          tenantName: tName || '',
          siteName: site.name,
          floorName: b.name,
          levelNumber: intOrNull(b.level_number),
        });
      }
    } catch (e) {
      console.error('[floors.create] notify failed:', e && e.message);
    }
  })();

  return created(res, { id: r.insertId }, 'Floor created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'floors', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  // Cross-org guard via parent site.
  const role = req.user.role;
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    const siteRow = (await query(
      'SELECT organisation_id FROM `sites` WHERE id = ? LIMIT 1',
      [r.row.site_id]
    ))[0];
    if (!siteRow || siteRow.organisation_id !== req.user.organisation_id) {
      return fail(res, 'Forbidden', 403);
    }
  }

  const b = req.body || {};

  // If the caller is trying to move the floor to a different building, the
  // new building MUST live under the same site as the current floor. Moving
  // a floor across sites via the Building path is forbidden — a dedicated
  // "move floor to another site" workflow can come later if we ever need it.
  let newBuildingId = null;
  if (Object.prototype.hasOwnProperty.call(b, 'building_id') && b.building_id !== null && b.building_id !== undefined && b.building_id !== '') {
    const target = intOrNull(b.building_id);
    if (target === null) return fail(res, 'Invalid building_id', 422);
    if (target !== r.row.building_id) {
      const bScope = await assertOrgScope(req, 'buildings', target);
      if (!bScope.ok) return fail(res, bScope.msg, bScope.status);
      const bOwn = await assertOwnership(req, 'buildings', target);
      if (!bOwn.ok) return fail(res, bOwn.msg, bOwn.status);
      if (bOwn.row.site_id !== r.row.site_id) {
        return fail(
          res,
          'Cannot move floor: target building belongs to a different site. Use a site-move workflow.',
          422
        );
      }
      newBuildingId = target;
    }
  }

  // layout_image_url has three meanings on PATCH:
  //   - undefined  -> leave unchanged (we don't include the column in UPDATE)
  //   - empty/null -> clear it (remove the floor's plan)
  //   - data URL   -> set/replace it (bounded by the same 2 MB cap as create)
  let setImageClause = '';
  const params = [b.name || null, intOrNull(b.level_number), intOrNull(b.status)];
  if (Object.prototype.hasOwnProperty.call(b, 'layout_image_url')) {
    if (!b.layout_image_url) {
      setImageClause = ', layout_image_url = NULL';
    } else if (typeof b.layout_image_url === 'string' && b.layout_image_url.length <= 2 * 1024 * 1024) {
      setImageClause = ', layout_image_url = ?';
      params.push(b.layout_image_url);
    }
    // (oversized strings are silently dropped — UI rejects this client-side)
  }

  let setBuildingClause = '';
  if (newBuildingId !== null) {
    setBuildingClause = ', building_id = ?';
    params.push(newBuildingId);
  }

  params.push(id);

  await execute(
    'UPDATE `floors` SET ' +
    '  name         = COALESCE(?, name), ' +
    '  level_number = COALESCE(?, level_number), ' +
    '  status       = COALESCE(?, status) ' +
    setImageClause +
    setBuildingClause + ' ' +
    'WHERE id = ?',
    params
  );
  return ok(res, null, 'Floor updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'floors', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  await execute('UPDATE `floors` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Floor deleted');
});
