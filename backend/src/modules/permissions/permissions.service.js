// Permission resolution + cache.
//
// Resolution order per (tenant, role, key):
//   tenant override (role_permissions.tenant_id = X)
//   -> global override (role_permissions.tenant_id IS NULL)
//   -> code default (permissions.catalog.js)
//
// super_admin short-circuits to 'yes' for everything.
//
// Cache: one Map entry per tenant (+ one for globals), invalidated on save.
// The matrix changes rarely and reads happen on every gated request, so an
// in-memory cache with explicit invalidation is enough (single-process app;
// if we ever run multiple instances, add a version column and re-check it).

const { query } = require('../../db/pool');
const { ROLES, KEYS, defaultsFor } = require('./permissions.catalog');

const cache = new Map(); // key: 'global' | 'tenant:<id>' -> { role: { key: allowed } }

function cacheKey(tenantId) { return tenantId ? `tenant:${tenantId}` : 'global'; }

async function loadOverrides(tenantId) {
  const ck = cacheKey(tenantId);
  if (cache.has(ck)) return cache.get(ck);
  const rows = tenantId
    ? await query('SELECT role, permission_key, allowed FROM `role_permissions` WHERE tenant_id = ?', [tenantId])
    : await query('SELECT role, permission_key, allowed FROM `role_permissions` WHERE tenant_id IS NULL');
  const out = {};
  ROLES.forEach((r) => { out[r] = {}; });
  rows.forEach((r) => {
    if (out[r.role] && KEYS.includes(r.permission_key)) out[r.role][r.permission_key] = r.allowed;
  });
  cache.set(ck, out);
  return out;
}

function invalidate(tenantId) { cache.delete(cacheKey(tenantId)); }

// Fully-resolved matrix for one scope. For the global scope (tenantId null)
// this is defaults + global overrides; for a tenant it also applies the
// tenant's own overrides on top.
async function resolveMatrix(tenantId) {
  const globals = await loadOverrides(null);
  const tenant = tenantId ? await loadOverrides(tenantId) : null;
  const matrix = {};
  ROLES.forEach((role) => {
    const resolved = { ...defaultsFor(role), ...globals[role], ...(tenant ? tenant[role] : {}) };
    matrix[role] = resolved;
  });
  return matrix;
}

// Effective permission set for a signed-in user -> { key: 'yes'|'team'|'no' }
async function effectiveFor(user) {
  if (!user) return {};
  if (user.role === 'super_admin') {
    const out = {};
    KEYS.forEach((k) => { out[k] = 'yes'; });
    return out;
  }
  const matrix = await resolveMatrix(user.tenant_id || null);
  return matrix[user.role] || {};
}

// can(user, key) -> boolean ('team' counts as allowed; the endpoint applies
// the team-scoping itself, same as the existing dept-manager checks do).
async function can(user, key) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const eff = await effectiveFor(user);
  return eff[key] === 'yes' || eff[key] === 'team';
}

// Express middleware: requirePerm('audit.view')
// Adoption plan: new endpoints use this from day one; existing requireRole
// call sites migrate gradually (they behave identically until an admin edits
// the matrix, because the code defaults mirror today's hard-coded gates).
function requirePerm(key) {
  return async function (req, res, next) {
    try {
      if (await can(req.user, key)) return next();
      return res.status(403).json({ status: false, msg: 'Forbidden' });
    } catch (err) { return next(err); }
  };
}

module.exports = { resolveMatrix, effectiveFor, can, requirePerm, invalidate };
