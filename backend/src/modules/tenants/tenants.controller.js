// Tenants CRUD - super_admin only.

const { query, execute } = require('../../db/pool');
const { ok, created, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');
const mailer = require('../../utils/mailer');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;

exports.list = asyncHandler(async function (req, res) {
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const offset = (page - 1) * limit;

  const where = ['trash = 0'];
  const params = [];
  if (req.query.q) {
    where.push('(name LIKE ? OR slug LIKE ? OR contact_email LIKE ?)');
    const like = '%' + req.query.q + '%';
    params.push(like, like, like);
  }
  if (req.query.status) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const whereSql = where.join(' AND ');

  const total = (await query(
    'SELECT COUNT(*) cnt FROM `tenants` WHERE ' + whereSql,
    params
  ))[0].cnt;

  const rows = await query(
    'SELECT id, name, slug, contact_email, contact_phone, currency_code, timezone, locale, status, created_at ' +
    ' FROM `tenants` WHERE ' + whereSql +
    ` ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return ok(res, { data: rows, total: total, current_page: page, per_page: limit });
});

exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const rows = await query('SELECT * FROM `tenants` WHERE id = ? AND trash = 0', [id]);
  if (rows.length === 0) return notFound(res, 'Tenant not found');
  return ok(res, rows[0]);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name) return fail(res, 'name is required', 422);
  if (!b.slug || !SLUG_RE.test(b.slug)) {
    return fail(res, 'slug is required (lowercase letters, digits, hyphens; 3-80 chars)', 422);
  }
  const dupe = await query('SELECT id FROM `tenants` WHERE slug = ? LIMIT 1', [b.slug]);
  if (dupe.length > 0) return fail(res, 'Slug already taken', 409);

  const r = await execute(
    'INSERT INTO `tenants` (name, slug, contact_email, contact_phone, currency_code, timezone, locale, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      b.name, b.slug,
      b.contact_email || null, b.contact_phone || null,
      b.currency_code || 'INR', b.timezone || 'Asia/Kolkata', b.locale || 'en-IN',
      b.status || 'trial',
    ]
  );

  // Welcome email to the tenant's contact address (fire-and-forget).
  if (b.contact_email) {
    mailer.tenantCreated({
      to: b.contact_email,
      tenantName: b.name,
      slug: b.slug,
    });
  }

  return created(res, { id: r.insertId }, 'Tenant created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const b = req.body || {};
  await execute(
    'UPDATE `tenants` SET ' +
    '  name          = COALESCE(?, name), ' +
    '  contact_email = COALESCE(?, contact_email), ' +
    '  contact_phone = COALESCE(?, contact_phone), ' +
    '  currency_code = COALESCE(?, currency_code), ' +
    '  timezone      = COALESCE(?, timezone), ' +
    '  locale        = COALESCE(?, locale), ' +
    '  status        = COALESCE(?, status), ' +
    // F03 - public portal opt-in
    '  public_portal_enabled = COALESCE(?, public_portal_enabled), ' +
    '  public_slug   = COALESCE(?, public_slug) ' +
    'WHERE id = ?',
    [
      b.name || null, b.contact_email || null, b.contact_phone || null,
      b.currency_code || null, b.timezone || null, b.locale || null,
      b.status || null,
      b.public_portal_enabled === undefined ? null : (b.public_portal_enabled ? 1 : 0),
      b.public_slug !== undefined ? (String(b.public_slug || '').trim() || null) : null,
      id,
    ]
  );
  return ok(res, null, 'Tenant updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  await execute('UPDATE `tenants` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Tenant deleted');
});
