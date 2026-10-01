// deskLayout.js — the ONE module that owns desk/chair identity rules.
//
// SRP: pure layout logic only — parsing, ID validation, canonical ID
// assignment, and old-vs-new diffing. No DB access (callers fetch what they
// need and pass it in), which keeps every function unit-testable and lets
// facilities save, bookings validation, the backfill script and the future
// QR module all share ONE implementation (Open/Closed: new consumers import,
// they don't re-implement).
//
// Canonical stable ID: FAC<facilityId>-D<seq>   e.g. FAC42-D007
//   - survives label changes, drags, floor-plan re-uploads
//   - safe to embed in QR payloads and URLS (strict allow-list below)
//
// OWASP notes:
//   A03 (injection): IDs are allow-listed to [A-Za-z0-9_-]{1,64}. They end up
//     in SQL params (parameterized anyway), JSON, URLs and printed QR labels,
//     so we refuse anything outside the allow-list at the boundary.
//   A04 (insecure design): renames/removals of chairs that still have future
//     bookings are rejected — bookings.desk_id references must never dangle.

'use strict';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Safe parse: string | object | null -> layout object or null (never throws). */
function parseLayout(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Bookable seat objects for v2 ({objects, type:'chair'}) and v1 ({desks}). */
function seatObjects(layout) {
  if (!layout) return [];
  if (Array.isArray(layout.objects)) return layout.objects.filter((o) => o && o.type === 'chair');
  if (Array.isArray(layout.desks))   return layout.desks.filter((d) => d && d.type === 'desk');
  return [];
}

/** All seat ids present in a layout (raw / string / object). */
function seatIds(rawOrLayout) {
  const layout = typeof rawOrLayout === 'string' ? parseLayout(rawOrLayout) : rawOrLayout;
  return seatObjects(layout).map((o) => o.id).filter((id) => typeof id === 'string' && id.length > 0);
}

function canonicalId(facilityId, seq) {
  return `FAC${facilityId}-D${String(seq).padStart(3, '0')}`;
}

/** Highest existing canonical sequence for this facility, so new chairs
 *  continue numbering instead of colliding with historic ids. */
function maxCanonicalSeq(facilityId, ids) {
  const re = new RegExp(`^FAC${facilityId}-D(\\d+)$`);
  let max = 0;
  ids.forEach((id) => {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max;
}

/**
 * Validate a layout about to be saved and assign canonical ids to new chairs.
 *
 * @param {object} opts
 * @param {string|object} opts.layout          incoming layout (string or object)
 * @param {number}        opts.facilityId      owning facility (for canonical ids)
 * @param {string|object} [opts.previousLayout] the currently-stored layout, for diffing
 * @param {string[]}      [opts.futureBookedIds] chair ids referenced by future bookings
 * @returns {{ ok:true, layoutJson:string, assigned:number }
 *        |  { ok:false, code:'DESK_ID_INVALID'|'DESK_ID_CONFLICT'|'LAYOUT_INVALID', message:string, conflicts?:string[] }}
 */
function validateAndNormalizeLayout({ layout, facilityId, previousLayout, futureBookedIds = [] }) {
  const parsed = parseLayout(layout);
  if (!parsed) return { ok: false, code: 'LAYOUT_INVALID', message: 'layout_json is not valid JSON' };

  const seats = seatObjects(parsed);

  // 1. Charset allow-list on every provided id.
  for (const s of seats) {
    if (s.id != null && s.id !== '' && !ID_RE.test(String(s.id))) {
      return {
        ok: false, code: 'DESK_ID_INVALID',
        message: `Desk id "${String(s.id).slice(0, 80)}" is invalid — allowed: letters, digits, "-", "_" (max 64 chars).`,
      };
    }
  }

  // 2. Uniqueness within the layout.
  const seen = new Set();
  for (const s of seats) {
    if (s.id == null || s.id === '') continue;
    if (seen.has(s.id)) {
      return {
        ok: false, code: 'DESK_ID_CONFLICT',
        message: `Duplicate desk id "${s.id}" in layout — every chair needs a unique stable id.`,
        conflicts: [s.id],
      };
    }
    seen.add(s.id);
  }

  // 3. Chairs that vanished (removed OR renamed) while still holding future
  //    bookings — the DB would be left with dangling bookings.desk_id refs.
  const prevIds = new Set(seatIds(previousLayout));
  if (prevIds.size > 0) {
    const removed = [...prevIds].filter((id) => !seen.has(id));
    const conflicted = removed.filter((id) => futureBookedIds.includes(id));
    if (conflicted.length > 0) {
      return {
        ok: false, code: 'DESK_ID_CONFLICT',
        message: `Desk id(s) ${conflicted.join(', ')} have future bookings and cannot be removed or renamed. ` +
                 'Cancel or move those bookings first.',
        conflicts: conflicted,
      };
    }
  }

  // 4. Assign canonical ids to chairs that arrived without one — or with an
  //    editor placeholder ("tmp-*"): the editor mints tmp ids for brand-new
  //    chairs so it never resurrects a deleted chair's id; the server is the
  //    single authority for permanent identity.
  const needsId = (id) => id == null || id === '' || /^tmp-/.test(String(id));
  let seq = maxCanonicalSeq(facilityId, [...seen]);
  let assigned = 0;
  for (const s of seats) {
    if (needsId(s.id)) {
      do { seq += 1; } while (seen.has(canonicalId(facilityId, seq)));
      s.id = canonicalId(facilityId, seq);
      seen.add(s.id);
      assigned += 1;
    }
  }

  return { ok: true, layoutJson: JSON.stringify(parsed), assigned };
}

/** Split a bookings.desk_id cell (comma-joined) into clean id array. */
function splitBookingDeskIds(cell) {
  if (!cell) return [];
  return String(cell).split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  ID_RE, parseLayout, seatObjects, seatIds,
  canonicalId, maxCanonicalSeq,
  validateAndNormalizeLayout, splitBookingDeskIds,
};
