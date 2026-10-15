// Signed tokens for the email-driven rating flow.
//
// The feedbackMailer embeds a token in the "Rate this booking" email link.
// When the recipient clicks, the public rating page extracts the token
// from the URL and the backend verifies it before letting the submission
// go through — no login required.
//
// Format: base64url(payload) + '.' + base64url(hmac_sha256(payload))
// Payload is JSON: { b: bookingId, u: userId, iat: epochSec, exp: epochSec }
//
// Verification checks:
//   • Signature matches (prevents tampering)
//   • Not expired (exp > now)
//   • Can also cross-check against DB (user_id matches booking.user_id)
//
// The signing secret comes from JWT_SECRET (same secret used for login
// JWTs — no new env var needed). The payload is NOT a full JWT because we
// don't need the JWT ecosystem overhead; a raw HMAC is simpler and keeps
// the URL short enough to drop into an email.

const crypto = require('crypto');
const config = require('../config');

const DEFAULT_TTL_DAYS = 30;

function secret() {
  const s = config.jwt && config.jwt.secret;
  if (!s) {
    throw new Error('ratingToken: JWT_SECRET missing from config');
  }
  return s;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * Build a signed token for a (bookingId, userId) pair.
 * @param {number} bookingId
 * @param {number} userId
 * @param {{ ttlDays?: number }} [opts]
 * @returns {string} compact 'payload.signature' token suitable for a URL
 */
function sign(bookingId, userId, opts) {
  const ttlDays = (opts && opts.ttlDays) || DEFAULT_TTL_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    b: Number(bookingId),
    u: Number(userId),
    iat: now,
    exp: now + ttlDays * 24 * 60 * 60,
  };
  const payloadStr = base64url(JSON.stringify(payload));
  const sig = base64url(
    crypto.createHmac('sha256', secret()).update(payloadStr).digest()
  );
  return payloadStr + '.' + sig;
}

/**
 * Verify a token. Returns { ok: true, payload } or { ok: false, msg }.
 * Uses crypto.timingSafeEqual to avoid timing attacks on the signature
 * comparison.
 */
function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) {
    return { ok: false, msg: 'malformed token' };
  }
  const dot = token.indexOf('.');
  const payloadStr = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = base64url(
    crypto.createHmac('sha256', secret()).update(payloadStr).digest()
  );
  // Timing-safe compare — requires equal-length buffers.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, msg: 'bad signature' };
  }
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadStr).toString('utf8'));
  } catch {
    return { ok: false, msg: 'malformed payload' };
  }
  if (!payload || typeof payload.b !== 'number' || typeof payload.u !== 'number') {
    return { ok: false, msg: 'malformed payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { ok: false, msg: 'token expired' };
  }
  return { ok: true, payload };
}

module.exports = { sign, verify };
