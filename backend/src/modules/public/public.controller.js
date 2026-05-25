// F03 - Public portal endpoints.
//
// All endpoints here are UNAUTHENTICATED. They live behind the /public
// router which does NOT mount authRequired. Tenant lookup is by public_slug,
// gated by public_portal_enabled=1. Only whitelisted columns are returned -
// no PII (booker emails, attendee counts, internal ids that could be guessed).

const { query } = require('../../db/pool');
const { ok, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');

async function resolveTenant(slug) {
  const rows = await query(
    'SELECT id, name, public_slug ' +
    '  FROM `tenants` ' +
    ' WHERE public_portal_enabled = 1 AND public_slug = ? LIMIT 1',
    [slug]
  );
  return rows[0] || null;
}

exports.landing = asyncHandler(async function (req, res) {
  const t = await resolveTenant(req.params.slug);
  if (!t) return notFound(res, 'Page not found');

  const [siteCnt, facCnt] = await Promise.all([
    query("SELECT COUNT(*) c FROM `sites` WHERE tenant_id = ? AND status = 1", [t.id]),
    query(
      "SELECT COUNT(*) c FROM `facilities` " +
      " WHERE tenant_id = ? AND status = 1 AND trash = 0 AND public_listed = 1",
      [t.id]
    ),
  ]);

  // Featured: a few public-listed facilities to show on the landing page.
  const featured = await query(
    'SELECT f.id, f.name, f.type, f.capacity, f.image_url, s.name AS site_name ' +
    '  FROM `facilities` f ' +
    '  INNER JOIN `sites` s ON s.id = f.site_id ' +
    ' WHERE f.tenant_id = ? AND f.status = 1 AND f.trash = 0 AND f.public_listed = 1 ' +
    ' ORDER BY f.id DESC LIMIT 6',
    [t.id]
  );

  res.set('Cache-Control', 'public, max-age=300');
  return ok(res, {
    tenant: { name: t.name, slug: t.public_slug },
    site_count: Number(siteCnt[0].c),
    facility_count: Number(facCnt[0].c),
    featured,
  });
});

exports.sites = asyncHandler(async function (req, res) {
  const t = await resolveTenant(req.params.slug);
  if (!t) return notFound(res, 'Page not found');

  const rows = await query(
    'SELECT s.id, s.name, s.address, ' +
    '       (SELECT COUNT(*) FROM `facilities` f ' +
    '         WHERE f.site_id = s.id AND f.status = 1 AND f.trash = 0 AND f.public_listed = 1 ' +
    '       ) AS facility_count ' +
    '  FROM `sites` s ' +
    ' WHERE s.tenant_id = ? AND s.status = 1 ' +
    ' ORDER BY s.name',
    [t.id]
  );
  res.set('Cache-Control', 'public, max-age=300');
  return ok(res, { tenant: { name: t.name, slug: t.public_slug }, sites: rows });
});

exports.siteFacilities = asyncHandler(async function (req, res) {
  const t = await resolveTenant(req.params.slug);
  if (!t) return notFound(res, 'Page not found');
  const siteId = intOrNull(req.params.siteId);
  if (siteId === null) return notFound(res, 'Site not found');

  const sites = await query(
    'SELECT id, name, address FROM `sites` WHERE id = ? AND tenant_id = ? AND status = 1 LIMIT 1',
    [siteId, t.id]
  );
  if (sites.length === 0) return notFound(res, 'Site not found');

  const facilities = await query(
    'SELECT id, name, type, capacity, image_url, description ' +
    '  FROM `facilities` ' +
    ' WHERE tenant_id = ? AND site_id = ? AND status = 1 AND trash = 0 AND public_listed = 1 ' +
    ' ORDER BY name',
    [t.id, siteId]
  );
  res.set('Cache-Control', 'public, max-age=300');
  return ok(res, { tenant: { name: t.name, slug: t.public_slug }, site: sites[0], facilities });
});

exports.facility = asyncHandler(async function (req, res) {
  const t = await resolveTenant(req.params.slug);
  if (!t) return notFound(res, 'Page not found');
  const facId = intOrNull(req.params.id);
  if (facId === null) return notFound(res, 'Facility not found');

  const rows = await query(
    'SELECT f.id, f.name, f.type, f.capacity, f.description, f.image_url, ' +
    '       s.name AS site_name, fl.name AS floor_name ' +
    '  FROM `facilities` f ' +
    '  INNER JOIN `sites` s ON s.id = f.site_id ' +
    '  LEFT JOIN `floors` fl ON fl.id = f.floor_id ' +
    ' WHERE f.id = ? AND f.tenant_id = ? AND f.status = 1 AND f.trash = 0 AND f.public_listed = 1 ' +
    ' LIMIT 1',
    [facId, t.id]
  );
  if (rows.length === 0) return notFound(res, 'Facility not found');

  const hours = await query(
    'SELECT day_of_week, ' +
    "       TIME_FORMAT(open_time,  '%H:%i') AS open_time, " +
    "       TIME_FORMAT(close_time, '%H:%i') AS close_time " +
    '  FROM `facility_operating_hours` WHERE facility_id = ? ORDER BY day_of_week, open_time',
    [facId]
  );

  res.set('Cache-Control', 'public, max-age=300');
  return ok(res, { tenant: { name: t.name, slug: t.public_slug }, facility: rows[0], operating_hours: hours });
});
