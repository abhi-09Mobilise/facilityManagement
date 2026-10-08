// F03 - Public portal endpoints.
//
// All endpoints here are UNAUTHENTICATED. They live behind the /public
// router which does NOT mount authRequired. Tenant lookup is by public_slug,
// gated by public_portal_enabled=1. Only whitelisted columns are returned -
// no PII (booker emails, attendee counts, internal ids that could be guessed).

const { query, execute } = require('../../db/pool');
const { ok, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');
const checkinCode = require('../../utils/checkinCode');     // M15
const checkinWindow = require('../../utils/checkinWindow');  // M15

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

// ----- M15 QR check-in ----------------------------------------------------
// POST /public/checkin   body: { code }
//
// The single generic check-in page (reached by scanning the venue QR) posts
// the code the booker got in their confirmation email. No login, no tenant
// context — the code alone resolves the booking. Protected by the router's
// 120 req/min/IP limiter, which makes guessing against a ~1e12 code space
// pointless. We never return booker PII; only the facility + time the code
// holder already knows.
exports.checkin = asyncHandler(async function (req, res) {
  const code = checkinCode.normalize((req.body || {}).code);
  console.log("CODE", code)
  if (!code) {
    return fail(res, 'Enter the check-in code from your confirmation email.', 400,
      { code: 'CHECKIN_CODE_INVALID' });
  }

  // The window (too_early / too_late) is classified by MySQL against NOW() so
  // it's immune to the Node process timezone — see checkinWindow.js.
  const win = checkinWindow.windowColumns('b.start_at');
  const rows = await query(
    'SELECT b.id, b.status, b.start_at, b.end_at, b.checked_in_at, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       ' + win.columns + ' ' +
    '  FROM `bookings`   b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    ' WHERE b.checkin_code = ? AND b.trash = 0 LIMIT 1',
    [code]
  );
  if (rows.length === 0) {
    return fail(res, "We couldn't find that code. Check your confirmation email and try again.",
      404, { code: 'CHECKIN_CODE_UNKNOWN' });
  }
  const b = rows[0];

  // Debug: see exactly what the DB clock thinks vs the booking start.
  console.log('[checkin]', {
    code, booking: b.id, status: b.status,
    start_at: b.start_at, server_now: b.server_now,
    opens_at: b.opens_at, closes_at: b.closes_at,
    too_early: b.too_early, too_late: b.too_late,
  });

  const card = {
    facility_name: b.facility_name,
    facility_type: b.facility_type,
    start_at: b.start_at,
    end_at: b.end_at,
  };

  // Already here — idempotent success, no second write.
  if (b.checked_in_at) {
    return ok(res, { ...card, checked_in_at: b.checked_in_at, already: true },
      "You're already checked in.");
  }

  if (b.status !== 'approved') {
    const msg = b.status === 'cancelled'
      ? 'This booking was cancelled, so it can\'t be checked in.'
      : b.status === 'pending'
        ? 'This booking is still awaiting approval. You can check in once it\'s confirmed.'
        : `This booking can't be checked in (status: ${b.status}).`;
    return fail(res, msg, 422, { code: 'CHECKIN_NOT_APPROVED', ...card });
  }

  // MySQL returns boolean expressions as 1/0.
  if (Number(b.too_early) === 1) {
    return fail(res,
      `Too early — check-in opens at ${b.opens_at}, ${checkinWindow.opensMin()} minutes before your booking.`,
      422, { code: 'CHECKIN_TOO_EARLY', ...card });
  }
  if (Number(b.too_late) === 1) {
    return fail(res,
      'Too late — the check-in window for this booking has closed.',
      422, { code: 'CHECKIN_TOO_LATE', ...card });
  }

  // Race-safe: only the first request that flips NULL -> NOW() "wins", but a
  // concurrent double-scan still returns success below either way.
  const result = await execute(
    'UPDATE `bookings` SET checked_in_at = NOW() WHERE id = ? AND checked_in_at IS NULL',
    [b.id]
  );
  if (result.affectedRows === 0) {
    // Someone (or a double-tap) checked in a split second before us.
    const again = await query('SELECT checked_in_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
    return ok(res, { ...card, checked_in_at: again[0] && again[0].checked_in_at, already: true },
      "You're already checked in.");
  }
  const fresh = await query('SELECT checked_in_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
  return ok(res, { ...card, checked_in_at: fresh[0] && fresh[0].checked_in_at, already: false },
    "You're checked in. Have a great session!");
});
