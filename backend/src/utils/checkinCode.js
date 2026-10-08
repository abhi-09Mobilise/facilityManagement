// checkinCode.js — the ONE owner of the arrival check-in code.
//
// The code is emailed to the booker and typed back on the public /checkin
// page. It must be:
//   - non-guessable        we never expose the raw (sequential) booking id
//   - human-transcribable   read off a phone, typed on a phone keypad
//   - globally unique       the public endpoint resolves a booking from the
//                           code alone, with no tenant/login context
//
// Alphabet: Crockford-ish, no ambiguous glyphs (0/O, 1/I/L). 8 chars over a
// 32-symbol alphabet ≈ 32^8 ≈ 1.1e12 combinations — brute force is hopeless
// under the public router's 120 req/min/IP rate limit.

'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols
const LEN = 8;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

/** Cryptographically-random code, e.g. "H7KQ2M9D". */
function generate() {
  // Rejection-free mapping: 32 divides 256 evenly, so every byte maps to
  // exactly one symbol with no modulo bias.
  const bytes = crypto.randomBytes(LEN);
  let out = '';
  for (let i = 0; i < LEN; i += 1) out += ALPHABET[bytes[i] & 31];
  return out;
}

/**
 * Normalise user input into canonical form, or null if it can't be one.
 * Users may paste "h7kq-2m9d" or "h7 kq 2m9d" — we uppercase and strip
 * anything outside the alphabet (spaces, hyphens), then validate length.
 */
function normalize(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(cleaned) ? cleaned : null;
}

/**
 * Generate a code not already present in `bookings.checkin_code`.
 * Collisions are astronomically unlikely; the loop + the UNIQUE index are
 * belt-and-braces. `runQuery` is the pool's `query` (or a txn-bound equivalent).
 */
async function generateUnique(runQuery, maxTries = 5) {
  for (let i = 0; i < maxTries; i += 1) {
    const code = generate();
    const rows = await runQuery(
      'SELECT 1 FROM `bookings` WHERE checkin_code = ? LIMIT 1',
      [code]
    );
    if (rows.length === 0) return code;
  }
  // 5 straight collisions against a 1e12 space is effectively impossible —
  // if we somehow get here, surface it rather than loop forever.
  throw new Error('Could not generate a unique check-in code');
}

/** Pretty form for the email, "H7KQ-2M9D". Storage/compare always use raw. */
function format(code) {
  return code && code.length === LEN ? code.slice(0, 4) + '-' + code.slice(4) : code;
}

module.exports = { ALPHABET, LEN, CODE_RE, generate, normalize, generateUnique, format };
