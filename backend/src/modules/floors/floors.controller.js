// Floors CRUD - tenant_admin (own tenant) or super_admin (any tenant).
// Floors belong to a site; the site's tenant_id is the source of truth.

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, assertOwnership } = require('../../utils/tenantScope');
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

  const rows = await query(
    'SELECT f.id, f.tenant_id, f.site_id, f.name, f.level_number, f.status, f.created_at, ' +
    '       t.name AS tenant_name, s.name AS site_name ' +
    '  FROM `floors` f ' +
    '  LEFT JOIN `tenants` t ON t.id = f.tenant_id ' +
    '  LEFT JOIN `sites`   s ON s.id = f.site_id ' +
    ' WHERE ' + where.join(' AND ') +
    ' ORDER BY f.level_number, f.name',
    params
  );
  return ok(res, rows);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name)    return fail(res, 'name is required', 422);
  if (!b.site_id) return fail(res, 'site_id is required', 422);

  const site = await assertOwnership(req, 'sites', intOrNull(b.site_id));
  if (!site.ok) return fail(res, site.msg, site.status);

  const r = await execute(
    'INSERT INTO `floors` (tenant_id, site_id, name, level_number) VALUES (?, ?, ?, ?)',
    [site.row.tenant_id, site.row.id, b.name, intOrNull(b.level_number)]
  );

  // Notify tenant admins (fire-and-forget).
  (async () => {
    try {
      const [emails, tName] = await Promise.all([
        tenantAdminEmails(site.row.tenant_id),
        tenantName(site.row.tenant_id),
      ]);
      if (emails.length > 0) {
        mailer.floorCreated({
          to: emails,
          tenantName: tName || '',
          siteName: site.row.name,
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

  const b = req.body || {};
  await execute(
    'UPDATE `floors` SET ' +
    '  name         = COALESCE(?, name), ' +
    '  level_number = COALESCE(?, level_number), ' +
    '  status       = COALESCE(?, status) ' +
    'WHERE id = ?',
    [b.name || null, intOrNull(b.level_number), intOrNull(b.status), id]
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
