// Embassy SSO — verify an Embassy-issued JWT so it can be exchanged for an FMS
// token at POST /api/auth/sso/embassy.
//
// Embassy signs its session tokens (Laravel tymon/jwt-auth, HS256) with its own
// secret. We verify with the SAME secret, provided here as EMBASSY_SHARED_SECRET
// (config.embassy.sharedSecret) — kept SEPARATE from FMS's own JWT_SECRET so
// adopting Embassy SSO never changes how FMS signs/verifies its own tokens.
//
// We intentionally do NOT enforce iss/aud: an Embassy token's `iss` is Embassy's
// own URL and it carries no `aud`, so those add nothing. The signature + expiry
// prove authenticity; the only identity claim we need is `sub` (the Embassy user
// id), which the exchange maps to users.external_id.
//
// Treat the secret like a password — never log it, rotate periodically.

const jwt = require('jsonwebtoken');
const config = require('../config');

class EmbassySsoError extends Error {
  constructor(code, msg, httpStatus) {
    super(msg);
    this.name = 'EmbassySsoError';
    this.code = code;
    this.httpStatus = httpStatus || 401;
  }
}

/**
 * Verify an Embassy-issued handoff/session JWT. Returns the decoded payload on
 * success, or throws EmbassySsoError (wrong signature, expired, missing sub…).
 */
function verifyEmbassyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new EmbassySsoError('EMBASSY_SSO_NO_TOKEN', 'token is required', 400);
  }

  const secret = config.embassy.sharedSecret;
  if (!secret) {
    throw new EmbassySsoError(
      'EMBASSY_SSO_NO_SECRET',
      'EMBASSY_SHARED_SECRET is not configured on this server.',
      500,
    );
  }
  console.log("EMBASSY SHARED :", secret);
  let decoded;
  try {
    decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: config.embassy.clockToleranceSec,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new EmbassySsoError('EMBASSY_SSO_EXPIRED', 'Embassy token has expired', 401);
    }
    if (err.name === 'NotBeforeError') {
      throw new EmbassySsoError('EMBASSY_SSO_NOT_YET_VALID', 'Embassy token is not yet valid', 401);
    }
    // JsonWebTokenError (bad signature, malformed, etc.)
    throw new EmbassySsoError('EMBASSY_SSO_INVALID', `Invalid Embassy token: ${err.message}`, 401);
  }

  // `sub` (Embassy user id) is the identifier we map to users.external_id.
  if (decoded.sub == null || String(decoded.sub).trim() === '') {
    throw new EmbassySsoError('EMBASSY_SSO_NO_SUB', 'Embassy token is missing the sub claim', 401);
  }

  return decoded;
}

module.exports = { verifyEmbassyToken, EmbassySsoError };
