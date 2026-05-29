// F06 - Pantries CRUD + menu items + facility-link helpers.
//
// Endpoints (mounted under /api/pantries):
//   GET    /                       list pantries (admins; ?site_id= filters)
//   POST   /                       create
//   GET    /:id                    one (with menu items)
//   PUT    /:id                    update name/site/status
//   DELETE /:id                    soft delete
//   GET    /:id/menu               menu items (employees can read for booking)
//   PUT    /:id/menu               replace-all menu items (admins)
//
// Plus the helper exports.byFacility(facilityId, conn?) used by booking flow.

const { query, withTransaction } = require('../../db/pool');
const { ok, created, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');

async function ownsPantry(req, pantryId) {
  const rows = await query('SELECT id, tenant_id FROM `pantries` WHERE id = ? LIMIT 1', [pantryId]);
  if (rows.length === 0) return null;
  if (req.user.role !== 'super_admin' && rows[0].tenant_id !== req.user.tenant_id) return null;
  return rows[0];
}

// GET /pantries  (?site_id=)
exports.list = asyncHandler(async function (req, res) {
  const tenantClause = req.user.role === 'super_admin'
    ? (req.query.tenant_id ? ' AND p.tenant_id = ?' : '')
    : ' AND p.tenant_id = ?';
  const tenantParams = req.user.role === 'super_admin'
    ? (req.query.tenant_id ? [Number(req.query.tenant_id)] : [])
    : [req.user.tenant_id];
  const siteId = intOrNull(req.query.site_id);
  const siteClause = siteId ? ' AND p.site_id = ?' : '';
  const params = [...tenantParams];
  if (siteId) params.push(siteId);

  const rows = await query(
    'SELECT p.id, p.tenant_id, p.site_id, s.name AS site_name, p.name, p.status, ' +
    '       (SELECT COUNT(*) FROM `pantry_menu_items` mi WHERE mi.pantry_id = p.id AND mi.status = 1) AS menu_count ' +
    '  FROM `pantries` p ' +
    '  INNER JOIN `sites` s ON s.id = p.site_id ' +
    ' WHERE p.trash = 0' + tenantClause + siteClause +
    ' ORDER BY s.name, p.name',
    params
  );
  return ok(res, rows);
});

// GET /pantries/:id
exports.getOne = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const owner = await ownsPantry(req, id);
  if (!owner) return notFound(res, 'Pantry not found');

  const rows = await query(
    'SELECT p.id, p.tenant_id, p.site_id, s.name AS site_name, p.name, p.status ' +
    '  FROM `pantries` p ' +
    '  INNER JOIN `sites` s ON s.id = p.site_id ' +
    ' WHERE p.id = ? AND p.trash = 0 LIMIT 1',
    [id]
  );
  if (rows.length === 0) return notFound(res, 'Pantry not found');
  const items = await query(
    'SELECT id, pantry_id, name, meal_time_id, price, is_paid, status ' +
    '  FROM `pantry_menu_items` WHERE pantry_id = ? ORDER BY name',
    [id]
  );
  return ok(res, { ...rows[0], menu: items });
});

// POST /pantries
exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  const tenantId = req.user.role === 'super_admin' ? intOrNull(b.tenant_id) : req.user.tenant_id;
  const siteId = intOrNull(b.site_id);
  const name = String(b.name || '').trim();
  if (!tenantId) return fail(res, 'tenant_id is required', 422);
  if (!siteId)   return fail(res, 'site_id is required', 422);
  if (!name)     return fail(res, 'name is required', 422);
  const status = b.status === 0 ? 0 : 1;

  const r = await query(
    'INSERT INTO `pantries` (tenant_id, site_id, name, status) VALUES (?, ?, ?, ?)',
    [tenantId, siteId, name, status]
  );
  return created(res, { id: r.insertId }, 'Pantry created');
});

// PUT /pantries/:id
exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const owner = await ownsPantry(req, id);
  if (!owner) return notFound(res, 'Pantry not found');
  const b = req.body || {};
  const fields = [];
  const params = [];
  if (b.name !== undefined)    { fields.push('name = ?');    params.push(String(b.name).trim()); }
  if (b.site_id !== undefined) { fields.push('site_id = ?'); params.push(intOrNull(b.site_id)); }
  if (b.status !== undefined)  { fields.push('status = ?');  params.push(b.status === 0 ? 0 : 1); }
  if (fields.length === 0) return ok(res, null, 'Nothing to update');
  params.push(id);
  await query('UPDATE `pantries` SET ' + fields.join(', ') + ' WHERE id = ?', params);
  return ok(res, null, 'Pantry updated');
});

// DELETE /pantries/:id  (soft)
exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const owner = await ownsPantry(req, id);
  if (!owner) return notFound(res, 'Pantry not found');
  await query('UPDATE `pantries` SET trash = 1, status = 0 WHERE id = ?', [id]);
  return ok(res, null, 'Pantry deleted');
});

// GET /pantries/:id/menu  - readable by any logged-in user (booking flow)
exports.listMenu = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  // Tenant-scope check: user must share tenant unless super_admin.
  const owner = await query('SELECT tenant_id FROM `pantries` WHERE id = ? AND trash = 0 LIMIT 1', [id]);
  if (owner.length === 0) return notFound(res, 'Pantry not found');
  if (req.user.role !== 'super_admin' && owner[0].tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  const rows = await query(
    'SELECT id, pantry_id, name, meal_time_id, price, is_paid, status ' +
    '  FROM `pantry_menu_items` WHERE pantry_id = ? AND status = 1 ORDER BY name',
    [id]
  );
  return ok(res, rows);
});

// PUT /pantries/:id/menu  - replace-all menu items (admins)
// Body: { items: [{ id?, name, meal_time_id?, price, status? }] }
exports.replaceMenu = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const owner = await ownsPantry(req, id);
  if (!owner) return notFound(res, 'Pantry not found');
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];

  await withTransaction(async function (conn) {
    await conn.execute('DELETE FROM `pantry_menu_items` WHERE pantry_id = ?', [id]);
    for (const it of items) {
      const name = String(it.name || '').trim();
      if (!name) continue;
      // is_paid drives whether the booker sees a price chip. Free items
      // pin price to 0 server-side so a stale value from the form doesn't
      // accidentally make a "free" item billable.
      const isPaid = it.is_paid === 1 || it.is_paid === true ? 1 : 0;
      const price = isPaid ? Number(it.price || 0) : 0;
      const mealId = it.meal_time_id ? Number(it.meal_time_id) : null;
      const status = it.status === 0 ? 0 : 1;
      await conn.execute(
        'INSERT INTO `pantry_menu_items` (pantry_id, name, meal_time_id, price, is_paid, status) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, mealId, price, isPaid, status]
      );
    }
  });
  return ok(res, { count: items.length }, 'Menu updated');
});

// Helper used by the booking flow: list pantries+menu linked to a facility.
// Returns: [{ id, name, items: [{ id, name, price, meal_time_id }] }]
exports.byFacility = async function byFacility(facilityId) {
  const pantries = await query(
    'SELECT p.id, p.name, p.site_id ' +
    '  FROM `pantries` p ' +
    '  INNER JOIN `facility_pantries` fp ON fp.pantry_id = p.id ' +
    ' WHERE fp.facility_id = ? AND p.trash = 0 AND p.status = 1 ' +
    ' ORDER BY p.name',
    [facilityId]
  );
  if (pantries.length === 0) return [];
  const ids = pantries.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = await query(
    'SELECT id, pantry_id, name, meal_time_id, price, is_paid ' +
    '  FROM `pantry_menu_items` WHERE status = 1 AND pantry_id IN (' + placeholders + ') ORDER BY name',
    ids
  );
  const byPantry = {};
  items.forEach((it) => { (byPantry[it.pantry_id] = byPantry[it.pantry_id] || []).push(it); });
  return pantries.map((p) => ({ ...p, items: byPantry[p.id] || [] }));
};
