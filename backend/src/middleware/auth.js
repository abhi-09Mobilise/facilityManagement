// JWT auth + light role-based gates.
// Token shape: { sub, username, name, email, role, tenant_id, organisation_id }
//   sub              - user id (used as req.user.id)
//   role             - 'super_admin' | 'tenant_admin' | 'org_admin' | 'approver' | 'employee'
//   tenant_id        - integer (null for super admins)
//   organisation_id  - integer (null for super admins and pre-org tokens)

const jwt = require('jsonwebtoken');
const config = require('../config');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  const scheme = parts[0];
  const token = parts[1];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ status: false, msg: 'Missing bearer token' });
  }
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: decoded.sub,
      username: decoded.username,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id || null,
      organisation_id: decoded.organisation_id || null,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ status: false, msg: 'Invalid or expired token' });
  }
}

// Convenience guard: requires the user to be one of the listed roles.
//   router.get('/admin-thing', authRequired, requireRole('super_admin'), handler)
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ status: false, msg: 'Forbidden' });
    }
    return next();
  };
}

// Cross-tenant guard. Only meaningful when the caller explicitly scopes a
// request by ?tenant_id=. A non-super-admin may only pass their OWN tenant_id;
// anything else is a cross-tenant probe and is rejected.
//
// When no tenant_id query param is present (e.g. a POST create, or a list that
// relies on the JWT), there is nothing to cross-check — the handler derives the
// tenant from req.user.tenant_id itself — so the request is allowed through.
function tenantChecker(req, res, next) {
  if (req.user && req.user.role === 'super_admin') return next();

  const q = req.query.tenant_id;
  const scoped = q !== undefined && q !== null && String(q).trim() !== '';
  if (scoped && String(q) !== String(req.user.tenant_id)) {
    return res.status(403).json({ status: false, msg: 'Forbidden' });
  }
  return next();
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id || null,
      organisation_id: user.organisation_id || null,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

module.exports = { authRequired, requireRole, signToken, tenantChecker };
