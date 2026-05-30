// Sites CRUD - tenant_admin (own tenant) or super_admin (any tenant via ?tenant_id=N).

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, effectiveTenantId, assertOwnership } = require('../../utils/tenantScope');
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

  // Free-text search across name, code, address. LIKE wildcards escaped.
  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const like = '%' + qRaw.replace(/[%_]/g, '\\$&') + '%';
    where.push('(s.name LIKE ? OR s.code LIKE ? OR s.address LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `sites` s WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT s.id, s.tenant_id, s.name, s.code, s.address, s.timezone, s.status, s.created_at, ' +
    '       t.name AS tenant_name ' +
    '  FROM `sites` s ' +
    '  LEFT JOIN `tenants` t ON t.id = s.tenant_id ' +
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
  const tenantId = effectiveTenantId(req, b.tenant_id);
  if (tenantId === null) return fail(res, 'tenant_id is required', 422);

  const r = await execute(
    'INSERT INTO `sites` (tenant_id, name, code, address, timezone) VALUES (?, ?, ?, ?, ?)',
    [tenantId, b.name, b.code || null, b.address || null, b.timezone || null]
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
