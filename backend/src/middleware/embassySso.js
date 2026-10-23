// Embassy SSO handoff — token validator.
//
// Verifies an HS256 JWT minted by the Embassy app, using the shared secret
// at config.embassy.sharedSecret. The same secret is held by Embassy
// (production) or by scripts/mint-test-handoff.js (local tests).
//
// Called by sso.controller — does NOT act as express middleware itself;
// returns a decoded payload or throws a well-typed error so the caller
// can produce a user-friendly HTTP response.
//
// Design notes:
//   - HS256 chosen because Embassy and FMS share a single secret.
//   - Treat the secret like a password — never log it, never commit it,
//     rotate periodically. A leak on either side compromises both.
//   - jti claim is REQUIRED to enable replay prevention (controller layer).
//   - Clock skew tolerated per config (default ±60s) — real-world servers
//     drift, and 401-ing legitimate users over 2s of skew is a terrible UX.
//   - FMS does NOT trust the `role` claim in the token; after lookup the
//     user's role comes from the FMS users table. This is deliberate —
//     authorization is FMS's job, Embassy only vouches for identity.

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
 * Verify an Embassy-issued handoff JWT. Returns the decoded payload on
 * success or throws EmbassySsoError on any failure (wrong signature,
 * expired, wrong issuer/audience, missing email, etc.).
 */
function verifyHandoffToken(token) {
  if (!config.embassy.ssoEnabled) {
    throw new EmbassySsoError(
      'EMBASSY_SSO_DISABLED',
      'Embassy SSO is not enabled on this server.',
      404,
    );
  }
  if (!token || typeof token !== 'string') {
    throw new EmbassySsoError('EMBASSY_SSO_NO_TOKEN', 'handoff_token is required', 400);
  }

  const secret = config.embassy.sharedSecret;
  if (!secret) {
    throw new EmbassySsoError(
      'EMBASSY_SSO_NO_SECRET',
      'Embassy SSO is enabled but EMBASSY_SHARED_SECRET is not configured in .env.',
      500,
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer:   config.embassy.issuer,
      audience: config.embassy.audience,
      clockTolerance: config.embassy.clockToleranceSec,
    });
  } catch (err) {
    // Translate jsonwebtoken's errors to our own codes so the controller
    // can log + respond consistently without parsing err.name strings.
    if (err.name === 'TokenExpiredError') {
      throw new EmbassySsoError('EMBASSY_SSO_EXPIRED', 'Handoff token has expired', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      throw new EmbassySsoError('EMBASSY_SSO_INVALID', `Invalid handoff token: ${err.message}`, 401);
    }
    if (err.name === 'NotBeforeError') {
      throw new EmbassySsoError('EMBASSY_SSO_NOT_YET_VALID', 'Handoff token is not yet valid', 401);
    }
    throw new EmbassySsoError('EMBASSY_SSO_VERIFY_FAILED', err.message || 'Verification failed', 401);
  }

  // `email` is the canonical identifier used to find the FMS user. `sub`
  // (Embassy user id) is logged for audit but no longer required.
  if (!decoded.email) {
    throw new EmbassySsoError('EMBASSY_SSO_NO_EMAIL', 'Handoff token missing email claim', 401);
  }
  if (!decoded.jti) {
    throw new EmbassySsoError('EMBASSY_SSO_NO_JTI', 'Handoff token missing jti claim (required for replay prevention)', 401);
  }

  return decoded;
}

module.exports = { verifyHandoffToken, EmbassySsoError };
