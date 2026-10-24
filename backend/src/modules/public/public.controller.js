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
const graceConfig = require('../../utils/graceConfig');      // M3 grace resolution
const mailer = require('../../utils/mailer');               // M15 check-in/out emails
const ratingToken = require('../../utils/ratingToken');     // email-driven feedback
const bookingsCtrl = require('../bookings/bookings.controller'); // reuse booking engine (doc 11 kiosk)

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
  // it's immune to the Node process timezone — see checkinWindow.js. Grace is
  // resolved per-scope (facility -> org -> tenant -> env) via graceConfig.
  const win = checkinWindow.windowColumns('b.start_at', graceConfig.graceSqlExpr());
  const rows = await query(
    'SELECT b.id, b.status, b.start_at, b.end_at, b.checked_in_at, b.checked_out_at, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.email AS booker_email, u.name AS booker_name, u.lname AS booker_lname, ' +
    '       ' + win.columns + ' ' +
    '  FROM `bookings`   b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    graceConfig.graceJoins() +
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

  // Already here — idempotent success, no second write. Surface checked_out_at
  // so the page can offer a "Check out" action.
  if (b.checked_in_at) {
    return ok(res, { ...card, checked_in_at: b.checked_in_at, checked_out_at: b.checked_out_at, already: true },
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
    const again = await query('SELECT checked_in_at, checked_out_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
    return ok(res, { ...card, checked_in_at: again[0] && again[0].checked_in_at, checked_out_at: again[0] && again[0].checked_out_at, already: true },
      "You're already checked in.");
  }
  const fresh = await query('SELECT checked_in_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
  const checkedInAt = fresh[0] && fresh[0].checked_in_at;

  // M15 - fire-and-forget confirmation to the booker. Never blocks the response
  // and never exposes the booker's address to the caller.
  if (b.booker_email) {
    mailer.bookingCheckedIn({
      to: b.booker_email,
      bookerName: [b.booker_name, b.booker_lname].filter(Boolean).join(' ') || null,
      facilityName: b.facility_name,
      facilityType: b.facility_type,
      startAt: b.start_at,
      endAt: b.end_at,
      checkedInAt,
    });
  }

  return ok(res, { ...card, checked_in_at: checkedInAt, already: false },
    "You're checked in. Have a great session!");
});

// ----- M15 QR check-out ---------------------------------------------------
// POST /public/checkout   body: { code }
//
// Same public, code-is-the-proof model as check-in. Allowed any time once the
// booking is checked in (no window), until checked out. Idempotent.
exports.checkout = asyncHandler(async function (req, res) {
  const code = checkinCode.normalize((req.body || {}).code);
  if (!code) {
    return fail(res, 'Enter the check-in code from your confirmation email.', 400,
      { code: 'CHECKIN_CODE_INVALID' });
  }

  const rows = await query(
    'SELECT b.id, b.status, b.start_at, b.end_at, b.checked_in_at, b.checked_out_at, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.email AS booker_email, u.name AS booker_name, u.lname AS booker_lname ' +
    '  FROM `bookings`   b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    ' WHERE b.checkin_code = ? AND b.trash = 0 LIMIT 1',
    [code]
  );
  if (rows.length === 0) {
    return fail(res, "We couldn't find that code. Check your confirmation email and try again.",
      404, { code: 'CHECKIN_CODE_UNKNOWN' });
  }
  const b = rows[0];
  const card = {
    facility_name: b.facility_name,
    facility_type: b.facility_type,
    start_at: b.start_at,
    end_at: b.end_at,
  };

  if (!b.checked_in_at) {
    return fail(res, "You haven't checked in yet, so there's nothing to check out of.",
      422, { code: 'CHECKOUT_NOT_CHECKED_IN', ...card });
  }
  if (b.checked_out_at) {
    return ok(res, { ...card, checked_in_at: b.checked_in_at, checked_out_at: b.checked_out_at, already: true },
      "You're already checked out.");
  }

  const result = await execute(
    'UPDATE `bookings` SET checked_out_at = NOW() ' +
    ' WHERE id = ? AND checked_in_at IS NOT NULL AND checked_out_at IS NULL',
    [b.id]
  );
  if (result.affectedRows === 0) {
    const again = await query('SELECT checked_out_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
    return ok(res, { ...card, checked_in_at: b.checked_in_at, checked_out_at: again[0] && again[0].checked_out_at, already: true },
      "You're already checked out.");
  }
  const fresh = await query('SELECT checked_out_at FROM `bookings` WHERE id = ? LIMIT 1', [b.id]);
  const checkedOutAt = fresh[0] && fresh[0].checked_out_at;

  if (b.booker_email) {
    mailer.bookingCheckedOut({
      to: b.booker_email,
      bookerName: [b.booker_name, b.booker_lname].filter(Boolean).join(' ') || null,
      facilityName: b.facility_name,
      facilityType: b.facility_type,
      startAt: b.start_at,
      endAt: b.end_at,
      checkedOutAt,
    });
  }

  return ok(res, { ...card, checked_in_at: b.checked_in_at, checked_out_at: checkedOutAt, already: false },
    "You're checked out. Thanks!");
});

// ---------- Feedback (email-driven, token-based) --------------------------

// GET /public/ratings/:token
// Returns the facility card for the token's booking + the existing rating
// (if any). The rating page uses this to pre-fill stars/comment/tags when
// the user clicks the email link a second time to edit their rating.
exports.ratingBooking = asyncHandler(async function (req, res) {
  const check = ratingToken.verify(req.params.token);
  if (!check.ok) return fail(res, 'Invalid or expired rating link', 400);
  const { b: bookingId, u: userId } = check.payload;

  const rows = await query(
    'SELECT b.id, b.user_id, b.status, b.start_at, b.end_at, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       s.name AS site_name ' +
    '  FROM `bookings` b ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  LEFT JOIN `sites` s ON s.id = f.site_id ' +
    ' WHERE b.id = ? AND b.user_id = ? LIMIT 1',
    [bookingId, userId]
  );
  if (rows.length === 0) return notFound(res, 'Booking not found');
  const b = rows[0];
  if (b.status !== 'completed') {
    return fail(res, 'This booking is not eligible for rating', 409);
  }

  const rRows = await query(
    'SELECT stars, comment, tags FROM `facility_ratings` WHERE booking_id = ? LIMIT 1',
    [bookingId]
  );
  const existing = rRows.length > 0 ? {
    stars: rRows[0].stars,
    comment: rRows[0].comment || null,
    tags: parsePublicTags(rRows[0].tags),
  } : null;

  return ok(res, {
    booking: {
      id: b.id,
      facility_name: b.facility_name,
      facility_type: b.facility_type,
      site_name: b.site_name || null,
      start_at: b.start_at,
      end_at: b.end_at,
    },
    existing_rating: existing,
  });
});

// POST /public/ratings/:token
// Body: { stars, comment?, tags? }
exports.submitRating = asyncHandler(async function (req, res) {
  const check = ratingToken.verify(req.params.token);
  if (!check.ok) return fail(res, 'Invalid or expired rating link', 400);
  const { b: bookingId, u: userId } = check.payload;

  const body = req.body || {};
  const stars = parseInt(body.stars, 10);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return fail(res, 'stars must be an integer between 1 and 5', 422);
  }

  // Re-verify the booking belongs to the token's user and is completed.
  const bRows = await query(
    'SELECT id, user_id, facility_id, tenant_id, status ' +
    '  FROM `bookings` WHERE id = ? LIMIT 1',
    [bookingId]
  );
  if (bRows.length === 0) return notFound(res, 'Booking not found');
  const bk = bRows[0];
  if (bk.user_id !== userId) return fail(res, 'Token/booking mismatch', 403);
  if (bk.status !== 'completed') {
    return fail(res, 'Only completed bookings can be rated', 409);
  }

  const comment = (typeof body.comment === 'string' && body.comment.trim())
    ? body.comment.trim().slice(0, 2000)
    : null;
  const tagsJson = Array.isArray(body.tags) && body.tags.length > 0
    ? JSON.stringify(body.tags.filter((t) => typeof t === 'string').slice(0, 10))
    : null;

  await query(
    'INSERT INTO `facility_ratings` ' +
    '  (booking_id, facility_id, tenant_id, user_id, stars, comment, tags) ' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE stars = VALUES(stars), comment = VALUES(comment), tags = VALUES(tags)',
    [bookingId, bk.facility_id, bk.tenant_id, bk.user_id, stars, comment, tagsJson]
  );

  return ok(res, { ok: true }, 'Thanks for your feedback!');
});

function parsePublicTags(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

// ===== Kiosk booking (doc 11) =============================================
// Public, tenant + organisation driven walk-up booking. The flow picks a
// tenant, then an organisation, then a facility. No token — tenant_id / org_id
// are plain params and every query is scoped to them. Booking identity is a
// synced Embassy employee (work email / employee id). The booking WRITE reuses
// the authed engine verbatim via invokeController — no divergent public logic.

// Resolve the tenant id from query/body. Writes a 422 + returns null if absent.
// Downstream queries are all scoped by this id, so an unknown id just yields
// empty lists rather than leaking anything.
function kioskTenant(req, res) {
  const tid = intOrNull(req.query.tenant_id || (req.body && req.body.tenant_id));
  if (tid === null) { fail(res, 'tenant_id is required', 422); return null; }
  return tid;
}

// Invoke an asyncHandler-wrapped controller with a synthetic req; capture the
// response it writes. Resolves { statusCode, body }. Lets the kiosk reuse
// bookings.create / dayAvailability without duplicating their logic.
function invokeController(handler, fakeReq) {
  return new Promise((resolve, reject) => {
    const cap = { statusCode: 200, body: null };
    const fakeRes = {
      status(code) { cap.statusCode = code; return this; },
      json(obj) { cap.body = obj; resolve(cap); return this; },
      set() { return this; },
    };
    Promise.resolve(handler(fakeReq, fakeRes, (err) => { if (err) reject(err); })).catch(reject);
  });
}

function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return null;
  const name = s.slice(0, at);
  const head = name.slice(0, 1);
  return head + '***' + s.slice(at);
}

// Resolve a synced employee within the kiosk tenant by email OR employee id
// (external_id). Must be active + approved to book. Returns the row or null.
async function resolveKioskEmployee(tenantId, identifierRaw) {
  const identifier = String(identifierRaw || '').trim();
  if (!identifier) return null;
  const isEmail = identifier.includes('@');
  const rows = await query(
    'SELECT id, name, lname, email, external_id, status, is_approved ' +
    '  FROM `users` ' +
    ' WHERE tenant_id = ? AND trash = 0 ' +
    (isEmail ? '   AND email = ? ' : '   AND external_id = ? ') +
    ' LIMIT 1',
    [tenantId, isEmail ? identifier.toLowerCase() : identifier]
  );
  return rows[0] || null;
}

// Confirm a facility belongs to the kiosk tenant and is publicly bookable.
async function kioskFacilityInTenant(tenantId, facilityId) {
  const rows = await query(
    'SELECT f.id FROM `facilities` f ' +
    ' WHERE f.id = ? AND f.tenant_id = ? AND f.trash = 0 AND f.status = 1 LIMIT 1',
    [facilityId, tenantId]
  );
  return rows.length > 0;
}

// GET /public/kiosk/tenants -> { tenants:[{id,name}] } — bookable tenants.
exports.kioskTenants = asyncHandler(async function (_req, res) {
  const tenants = await query(
    "SELECT id, name FROM `tenants` WHERE trash = 0 AND status IN ('active','trial') ORDER BY name"
  );
  res.set('Cache-Control', 'no-store');
  return ok(res, { tenants });
});

// GET /public/kiosk/organisations?tenant_id= -> { tenant, organisations }
exports.kioskOrganisations = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const trows = await query('SELECT id, name FROM `tenants` WHERE id = ? AND trash = 0 LIMIT 1', [tenantId]);
  if (trows.length === 0) return notFound(res, 'Tenant not found');
  const orgs = await query(
    'SELECT id, name FROM `organisations` WHERE tenant_id = ? AND trash = 0 AND status = 1 ORDER BY name',
    [tenantId]
  );
  res.set('Cache-Control', 'no-store');
  return ok(res, { tenant: trows[0], organisations: orgs });
});

// GET /public/kiosk/sites?tenant_id=&org_id= -> { sites:[{id,name,address}] }
exports.kioskSites = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const orgId = intOrNull(req.query.org_id);
  if (orgId === null) return fail(res, 'org_id is required', 422);
  const orgRows = await query(
    'SELECT id FROM `organisations` WHERE id = ? AND tenant_id = ? AND trash = 0 LIMIT 1',
    [orgId, tenantId]
  );
  if (orgRows.length === 0) return notFound(res, 'Organisation not found');
  const sites = await query(
    'SELECT id, name, address FROM `sites` ' +
    ' WHERE tenant_id = ? AND organisation_id = ? AND trash = 0 AND status = 1 ORDER BY name',
    [tenantId, orgId]
  );
  res.set('Cache-Control', 'no-store');
  return ok(res, { sites });
});

// GET /public/kiosk/facilities?tenant_id=&site_id= -> active facility cards for
// the site. Facilities link to a SITE (facility.site_id), so we scope by site.
// NOTE: no `public_listed` gate — that flag is for the anonymous public portal;
// the kiosk is a tenant+site-scoped terminal and shows all active facilities.
exports.kioskFacilities = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const siteId = intOrNull(req.query.site_id);
  if (siteId === null) return fail(res, 'site_id is required', 422);
  const siteRows = await query(
    'SELECT id, name FROM `sites` WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
    [siteId, tenantId]
  );
  if (siteRows.length === 0) return notFound(res, 'Site not found');

  const facilities = await query(
    'SELECT f.id, f.name, f.type, f.capacity, f.image_url, s.name AS site_name, fl.name AS floor_name ' +
    '  FROM `facilities` f ' +
    '  INNER JOIN `sites`  s  ON s.id = f.site_id ' +
    '  LEFT JOIN  `floors` fl ON fl.id = f.floor_id ' +
    ' WHERE f.tenant_id = ? AND f.site_id = ? ' +
    '   AND f.trash = 0 AND f.status = 1 ' +
    ' ORDER BY f.name',
    [tenantId, siteId]
  );
  res.set('Cache-Control', 'no-store');
  return ok(res, { site: siteRows[0], facilities });
});

// GET /public/kiosk/facilities/:id/day?token=&date= -> reuse dayAvailability
exports.kioskDay = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const facId = intOrNull(req.params.id);
  if (facId === null) return fail(res, 'Invalid facility id', 400);
  if (!(await kioskFacilityInTenant(tenantId, facId))) return notFound(res, 'Facility not found');

  const captured = await invokeController(bookingsCtrl.dayAvailability, {
    query: { facility_id: String(facId), date: String(req.query.date || ''), attendees: '1' },
  });
  return res.status(captured.statusCode).json(captured.body);
});

// GET /public/kiosk/facilities/:id?tenant_id= -> facility incl. layout_json
// (for the desk canvas). Scoped to the kiosk tenant.
exports.kioskFacilityDetail = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const facId = intOrNull(req.params.id);
  if (facId === null) return fail(res, 'Invalid facility id', 400);
  const rows = await query(
    'SELECT id, name, type, capacity, layout_json FROM `facilities` ' +
    ' WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
    [facId, tenantId]
  );
  if (rows.length === 0) return notFound(res, 'Facility not found');
  res.set('Cache-Control', 'no-store');
  return ok(res, { facility: rows[0] });
});

// GET /public/kiosk/facilities/:id/check?tenant_id=&start_at=&end_at=
// Reuses bookings.check (occupied_desks for the exact window, from the
// booking_desks junction) so the kiosk desk canvas greys out taken chairs
// identically to the authed picker.
exports.kioskCheck = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const facId = intOrNull(req.params.id);
  if (facId === null) return fail(res, 'Invalid facility id', 400);
  if (!(await kioskFacilityInTenant(tenantId, facId))) return notFound(res, 'Facility not found');

  const captured = await invokeController(bookingsCtrl.check, {
    user: { id: 0, role: 'employee', tenant_id: tenantId },
    query: {
      facility_id: String(facId),
      start_at: String(req.query.start_at || ''),
      end_at: String(req.query.end_at || ''),
      attendees: '1',
    },
  });
  return res.status(captured.statusCode).json(captured.body);
});

// POST /public/kiosk/identify { token, identifier } -> masked user or 404
exports.kioskIdentify = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const emp = await resolveKioskEmployee(tenantId, (req.body || {}).identifier);
  if (!emp) return fail(res, "We couldn't find you. Check your work email / employee ID, or see reception.", 404, { code: 'EMPLOYEE_NOT_FOUND' });
  if (emp.status !== 1 || Number(emp.is_approved) !== 1) {
    return fail(res, 'Your account is inactive. Please contact your administrator.', 403, { code: 'EMPLOYEE_INACTIVE' });
  }
  return ok(res, {
    user: {
      id: emp.id,
      name: [emp.name, emp.lname].filter(Boolean).join(' ') || null,
      masked_email: maskEmail(emp.email),
    },
  });
});

// POST /public/kiosk/book
//   { tenant_id, facility_id, start_at, end_at, title?,
//     assignments: [ { identifier, desk_id? }, ... ] }   // one booking per seat
//   (legacy single-booking shape { identifier, desk_ids? } is still accepted)
//
// Each assignment is resolved to a synced employee and booked AS them through
// the real engine — so a multi-seat kiosk booking becomes one booking per
// person (each gets their own approval / check-in code / email). All employees
// are validated up front so we don't half-book a group.
exports.kioskBook = asyncHandler(async function (req, res) {
  const tenantId = kioskTenant(req, res);
  if (!tenantId) return;
  const b = req.body || {};

  const facilityId = intOrNull(b.facility_id);
  if (facilityId === null) return fail(res, 'facility_id is required', 422);
  if (!(await kioskFacilityInTenant(tenantId, facilityId))) return notFound(res, 'Facility not found');

  // Normalise to an assignments list (at least one).
  let assignments = Array.isArray(b.assignments) && b.assignments.length
    ? b.assignments.map((a) => ({ identifier: a && a.identifier, desk_id: (a && a.desk_id) || null }))
    : [{ identifier: b.identifier, desk_id: Array.isArray(b.desk_ids) ? (b.desk_ids[0] || null) : (b.desk_id || null) }];

  // Resolve + validate EVERY employee before booking any — all-or-nothing on
  // identity so a bad email doesn't leave a half-booked group.
  const resolved = [];
  for (const a of assignments) {
    const emp = await resolveKioskEmployee(tenantId, a.identifier);
    if (!emp) {
      return fail(res, `We couldn't find an employee for "${a.identifier || '(blank)'}".`, 404,
        { code: 'EMPLOYEE_NOT_FOUND', identifier: a.identifier || null });
    }
    if (emp.status !== 1 || Number(emp.is_approved) !== 1) {
      return fail(res, `${a.identifier} is inactive and can't be booked.`, 403,
        { code: 'EMPLOYEE_INACTIVE', identifier: a.identifier });
    }
    resolved.push({ emp, desk_id: a.desk_id });
  }

  // One booking per assignment, each through the authed engine.
  const results = [];
  for (const r of resolved) {
    const captured = await invokeController(bookingsCtrl.create, {
      user: { id: r.emp.id, role: 'employee', tenant_id: tenantId },
      body: {
        facility_id: facilityId,
        start_at: b.start_at,
        end_at: b.end_at,
        title: (b.title && String(b.title).trim()) || 'Kiosk booking',
        desk_id: r.desk_id || undefined,
        channel: 'tablet',
      },
    });
    const body = captured.body || {};
    results.push({
      identifier: r.emp.email,
      desk_id: r.desk_id,
      ok: !!body.status,
      status: (body.data && body.data.status) || null,
      msg: body.msg || null,
    });
  }

  const booked = results.filter((x) => x.ok).length;
  return ok(res, { results, booked, total: results.length, all_ok: booked === results.length },
    booked === results.length ? 'Booked' : 'Some seats could not be booked');
});
