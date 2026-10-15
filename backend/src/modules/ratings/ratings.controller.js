// Facility feedback ratings — authenticated endpoints.
//
// Eligibility rules (enforced here AND surfaced in the Rate button on
// /my-bookings so users never see the button when they can't submit):
//   • Booking must belong to the caller (user_id match)
//   • Booking status must be 'completed'
//     (anything else means the person didn't actually use the facility)
//   • Booking's end_at must be in the past
//   • Only one rating per booking (UNIQUE KEY uq_rating_per_booking)
//     — subsequent calls return the existing row (idempotent for the UI)
//
// Payload: { booking_id, stars (1-5), comment?, tags? }
//   tags is an array of strings — stored as JSON. The UI uses a predefined
//   checkbox list; backend doesn't validate the string values so new tags
//   can be added client-side without a backend change.

const { query } = require('../../db/pool');
const { ok, fail, created } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');

// GET /api/ratings/mine/:bookingId
// Returns the caller's existing rating for the booking (if any). The
// /my-bookings page uses this to decide whether to show "Rate" or
// "✓ Rated" on each row.
exports.mineForBooking = asyncHandler(async function (req, res) {
  const bookingId = parseInt(req.params.bookingId, 10);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return fail(res, 'Invalid booking id', 400);
  }

  // Ownership check — anything but the booker gets a 404-shaped empty.
  const bRows = await query(
    'SELECT id, user_id FROM `bookings` WHERE id = ? LIMIT 1',
    [bookingId]
  );
  if (bRows.length === 0 || bRows[0].user_id !== req.user.id) {
    return ok(res, { rating: null });
  }

  const rRows = await query(
    'SELECT id, stars, comment, tags, created_at ' +
    '  FROM `facility_ratings` WHERE booking_id = ? LIMIT 1',
    [bookingId]
  );
  if (rRows.length === 0) return ok(res, { rating: null });
  const r = rRows[0];
  return ok(res, {
    rating: {
      id: r.id,
      stars: r.stars,
      comment: r.comment || null,
      tags: parseTags(r.tags),
      created_at: r.created_at,
    },
  });
});

// POST /api/ratings
// Body: { booking_id, stars, comment?, tags? }
exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  const bookingId = parseInt(b.booking_id, 10);
  const stars = parseInt(b.stars, 10);

  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return fail(res, 'booking_id is required', 422);
  }
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return fail(res, 'stars must be an integer between 1 and 5', 422);
  }

  // Load booking + verify eligibility.
  const bRows = await query(
    'SELECT id, user_id, facility_id, tenant_id, status, end_at ' +
    '  FROM `bookings` WHERE id = ? LIMIT 1',
    [bookingId]
  );
  if (bRows.length === 0) return fail(res, 'Booking not found', 404);
  const bk = bRows[0];
  if (bk.user_id !== req.user.id) {
    return fail(res, 'You can only rate your own bookings', 403);
  }
  if (bk.status !== 'completed') {
    return fail(res, 'Only completed bookings can be rated', 409);
  }
  // end_at check — belt-and-braces; a 'completed' booking should always
  // have an end_at in the past, but better to double-check than let
  // mis-sweeper'd rows slip through.
  if (bk.end_at && new Date(bk.end_at).getTime() > Date.now()) {
    return fail(res, 'Booking has not ended yet', 409);
  }

  const comment = (typeof b.comment === 'string' && b.comment.trim())
    ? b.comment.trim().slice(0, 2000)
    : null;
  const tagsJson = Array.isArray(b.tags) && b.tags.length > 0
    ? JSON.stringify(b.tags.filter((t) => typeof t === 'string').slice(0, 10))
    : null;

  // Upsert — allow a user to update their existing rating without an
  // explicit edit flow. ON DUPLICATE KEY mirrors the UNIQUE on booking_id.
  await query(
    'INSERT INTO `facility_ratings` ' +
    '  (booking_id, facility_id, tenant_id, user_id, stars, comment, tags) ' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE stars = VALUES(stars), comment = VALUES(comment), tags = VALUES(tags)',
    [bookingId, bk.facility_id, bk.tenant_id, req.user.id, stars, comment, tagsJson]
  );

  const rRows = await query(
    'SELECT id, stars, comment, tags, created_at FROM `facility_ratings` WHERE booking_id = ? LIMIT 1',
    [bookingId]
  );
  const r = rRows[0];
  return created(res, {
    rating: {
      id: r.id,
      booking_id: bookingId,
      stars: r.stars,
      comment: r.comment || null,
      tags: parseTags(r.tags),
      created_at: r.created_at,
    },
  });
});

// MySQL returns JSON columns as either a string (older drivers) or a
// parsed object (newer). Normalise to an array either way.
function parseTags(raw) {
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
