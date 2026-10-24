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
  // Optional facility scope — when a wall QR encodes `?facility=<id>`, the
  // client forwards it as `scope_facility_id`. We reject codes whose booking
  // is for a different facility, so someone standing at Boardroom A can't
  // check in a Hot-Desks booking by mistake. Absent = unscoped (keeps the
  // legacy generic QR working for backward compatibility).
  const scopeFacilityId = intOrNull((req.body || {}).scope_facility_id);
  if (!code) {
    return fail(res, 'Enter the check-in code from your confirmation email.', 400,
      { code: 'CHECKIN_CODE_INVALID' });
  }

  // The window (too_early / too_late) is classified by MySQL against NOW() so
  // it's immune to the Node process timezone — see checkinWindow.js. Grace is
  // resolved per-scope (facility -> org -> tenant -> env) via graceConfig.
  const win = checkinWindow.windowColumns('b.start_at', graceConfig.graceSqlExpr());
  const rows = await query(
    'SELECT b.id, b.facility_id, b.status, b.start_at, b.end_at, b.checked_in_at, b.checked_out_at, ' +
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

  // Enforce facility scope before any state mutation. Message names the
  // correct facility so the user knows which kiosk to use.
  if (scopeFacilityId !== null && Number(b.facility_id) !== scopeFacilityId) {
    return fail(
      res,
      `This QR is for a different facility. Your booking is for "${b.facility_name || 'another facility'}" — please scan that facility's QR instead.`,
      403,
      { code: 'CHECKIN_WRONG_FACILITY' }
    );
  }

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
  // Mirror the check-in scope guard so a wrong-facility kiosk also can't
  // close out someone else's active session.
  const scopeFacilityId = intOrNull((req.body || {}).scope_facility_id);
  if (!code) {
    return fail(res, 'Enter the check-in code from your confirmation email.', 400,
      { code: 'CHECKIN_CODE_INVALID' });
  }

  const rows = await query(
    'SELECT b.id, b.facility_id, b.status, b.start_at, b.end_at, b.checked_in_at, b.checked_out_at, ' +
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

  if (scopeFacilityId !== null && Number(b.facility_id) !== scopeFacilityId) {
    return fail(
      res,
      `This QR is for a different facility. Your booking is for "${b.facility_name || 'another facility'}" — please scan that facility's QR instead.`,
      403,
      { code: 'CHECKIN_WRONG_FACILITY' }
    );
  }

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
