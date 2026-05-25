// F06 - Facility <-> Pantries link (many-to-many).
//
// GET  /facilities/:id/pantries   list pantries linked to this facility
// PUT  /facilities/:id/pantries   replace-all { pantry_ids: number[] }
//
// The replace-all guards against cross-tenant assignment and against
// pantries from sites other than the facility's site (a pantry at site
// A can't be ordered from while booking a facility at site B).

const { query, withTransaction } = require('../../db/pool');
const { ok, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');

async function loadFacility(facilityId) {
  const rows = await query(
    'SELECT id, tenant_id, site_id FROM `facilities` WHERE id = ? LIMIT 1', [facilityId]
  );
  return rows[0] || null;
}

exports.list = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.params.id);
  if (facilityId === null) return fail(res, 'Invalid facility id', 400);
  const fac = await loadFacility(facilityId);
  if (!fac) return notFound(res, 'Facility not found');
  if (req.user.role !== 'super_admin' && fac.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  const rows = await query(
    'SELECT p.id, p.name, p.site_id ' +
    '  FROM `pantries` p ' +
    '  INNER JOIN `facility_pantries` fp ON fp.pantry_id = p.id ' +
    ' WHERE fp.facility_id = ? AND p.trash = 0 ORDER BY p.name',
    [facilityId]
  );
  return ok(res, rows);
});

exports.replace = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.params.id);
  if (facilityId === null) return fail(res, 'Invalid facility id', 400);
  const fac = await loadFacility(facilityId);
  if (!fac) return notFound(res, 'Facility not found');
  if (req.user.role !== 'super_admin' && fac.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  const ids = Array.isArray((req.body || {}).pantry_ids) ? req.body.pantry_ids : [];
  const cleanIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);

  // Validate every pantry id is on the same site + same tenant.
  if (cleanIds.length > 0) {
    const placeholders = cleanIds.map(() => '?').join(',');
    const rows = await query(
      'SELECT id, tenant_id, site_id FROM `pantries` WHERE id IN (' + placeholders + ') AND trash = 0',
      cleanIds
    );
    if (rows.length !== cleanIds.length) {
      return fail(res, 'One or more pantry ids are invalid.', 422);
    }
    for (const r of rows) {
      if (r.tenant_id !== fac.tenant_id || r.site_id !== fac.site_id) {
        return fail(res, 'A pantry must be on the same site as the facility.', 422);
      }
    }
  }

  await withTransaction(async function (conn) {
    await conn.execute('DELETE FROM `facility_pantries` WHERE facility_id = ?', [facilityId]);
    for (const pid of cleanIds) {
      await conn.execute(
        'INSERT INTO `facility_pantries` (facility_id, pantry_id) VALUES (?, ?)',
        [facilityId, pid]
      );
    }
  });
  return ok(res, { count: cleanIds.length }, 'Linked pantries updated');
});

// GET /facilities/:id/menu - flat: pantries with items, used by booking page.
exports.menuForBooking = asyncHandler(async function (req, res) {
  const facilityId = intOrNull(req.params.id);
  if (facilityId === null) return fail(res, 'Invalid facility id', 400);
  const fac = await loadFacility(facilityId);
  if (!fac) return notFound(res, 'Facility not found');
  if (req.user.role !== 'super_admin' && fac.tenant_id !== req.user.tenant_id) {
    return fail(res, 'Forbidden', 403);
  }
  const pantriesCtrl = require('../pantries/pantries.controller');
  const data = await pantriesCtrl.byFacility(facilityId);
  return ok(res, data);
});
