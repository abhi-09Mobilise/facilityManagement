// Roles & permissions matrix API.
//
//   GET  /api/permissions/catalog         - permission catalog (keys, labels, groups)
//   GET  /api/permissions/effective       - resolved permission set for the caller
//   GET  /api/permissions/matrix          - resolved matrix + raw overrides for a scope
//                                           ?tenant_id=X (super_admin only; omitted = global)
//   PUT  /api/permissions/matrix          - save override deltas for a scope
//
// Scope rules:
//   super_admin  -> edits global defaults (no tenant_id) or any tenant's overrides
//   tenant_admin -> edits ONLY their own tenant's overrides (needs roles.manage)
//
// Guardrails:
//   * super_admin is not an editable column (implicit yes, enforced by ENUM too)
//   * roles.manage can never be granted to employee
//   * a save may not leave zero admin roles with roles.manage in that scope

const { query, withTransaction } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { ROLES, CATALOG, KEYS, defaultsFor } = require('./permissions.catalog');
const svc = require('./permissions.service');

const ALLOWED_VALUES = ['yes', 'team', 'no'];

function editScope(req) {
  // Returns { tenantId } for the scope the caller may edit/view, or null if forbidden.
  const requested = req.query.tenant_id ? Number(req.query.tenant_id)
    : (req.body && req.body.tenant_id ? Number(req.body.tenant_id) : null);
  if (req.user.role === 'super_admin') return { tenantId: requested || null };
  if (req.user.role === 'tenant_admin') return { tenantId: req.user.tenant_id };
  return null;
}

exports.catalog = asyncHandler(async (_req, res) => {
  return ok(res, {
    roles: ROLES,
    groups: CATALOG.reduce((acc, [key, label, group]) => {
      (acc[group] = acc[group] || []).push({ key, label });
      return acc;
    }, {}),
  });
});

exports.effective = asyncHandler(async (req, res) => {
  return ok(res, { role: req.user.role, permissions: await svc.effectiveFor(req.user) });
});

exports.getMatrix = asyncHandler(async (req, res) => {
  const scope = editScope(req);
  if (!scope) return fail(res, 'Forbidden', 403);
  if (!(await svc.can(req.user, 'roles.manage'))) return fail(res, 'Forbidden', 403);

  const resolved = await svc.resolveMatrix(scope.tenantId);
  // Raw overrides for THIS scope only, so the UI can mark "inherited" cells.
  const raw = scope.tenantId
    ? await query('SELECT role, permission_key, allowed FROM `role_permissions` WHERE tenant_id = ?', [scope.tenantId])
    : await query('SELECT role, permission_key, allowed FROM `role_permissions` WHERE tenant_id IS NULL');
  const overrides = {};
  raw.forEach((r) => { (overrides[r.role] = overrides[r.role] || {})[r.permission_key] = r.allowed; });

  return ok(res, { tenant_id: scope.tenantId, resolved, overrides, defaults: Object.fromEntries(ROLES.map((r) => [r, defaultsFor(r)])) });
});

exports.saveMatrix = asyncHandler(async (req, res) => {
  const scope = editScope(req);
  if (!scope) return fail(res, 'Forbidden', 403);
  if (!(await svc.can(req.user, 'roles.manage'))) return fail(res, 'Forbidden', 403);

  // changes: [{ role, permission_key, allowed | null }]  (null = clear override)
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (changes.length === 0) return ok(res, { saved: 0 });

  for (const c of changes) {
    if (!ROLES.includes(c.role)) return fail(res, `Unknown role: ${c.role}`, 400);
    if (!KEYS.includes(c.permission_key)) return fail(res, `Unknown permission: ${c.permission_key}`, 400);
    if (c.allowed !== null && !ALLOWED_VALUES.includes(c.allowed)) {
      return fail(res, `Invalid value for ${c.permission_key}`, 400);
    }
    if (c.role === 'employee' && c.permission_key === 'roles.manage' && (c.allowed === 'yes' || c.allowed === 'team')) {
      return fail(res, 'roles.manage cannot be granted to employees', 400);
    }
  }

  // Lock-out guardrail: simulate the post-save matrix for this scope and make
  // sure at least one admin role still holds roles.manage.
  const simulated = await svc.resolveMatrix(scope.tenantId);
  changes.forEach((c) => {
    if (c.allowed === null) {
      // Clearing an override falls back to global/default — recompute lazily:
      // conservative approach: fall back to the code default for simulation.
      simulated[c.role][c.permission_key] = defaultsFor(c.role)[c.permission_key];
    } else {
      simulated[c.role][c.permission_key] = c.allowed;
    }
  });
  const someoneManages = ['tenant_admin', 'org_admin', 'approver']
    .some((r) => simulated[r]['roles.manage'] === 'yes');
  if (!someoneManages) {
    return fail(res, 'At least one admin role must keep "Edit roles & permissions" (super admins always retain it).', 400);
  }

  await withTransaction(async (conn) => {
    for (const c of changes) {
      if (c.allowed === null) {
        await conn.execute(
          scope.tenantId
            ? 'DELETE FROM `role_permissions` WHERE tenant_id = ? AND role = ? AND permission_key = ?'
            : 'DELETE FROM `role_permissions` WHERE tenant_id IS NULL AND role = ? AND permission_key = ?',
          scope.tenantId ? [scope.tenantId, c.role, c.permission_key] : [c.role, c.permission_key]
        );
      } else {
        await conn.execute(
          'INSERT INTO `role_permissions` (tenant_id, role, permission_key, allowed, updated_by) ' +
          'VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE allowed = VALUES(allowed), updated_by = VALUES(updated_by)',
          [scope.tenantId, c.role, c.permission_key, c.allowed, req.user.id]
        );
      }
    }
  });

  // Cache note: tenant cache entries hold only that tenant's own overrides;
  // resolveMatrix() merges globals at call time. So invalidating just the
  // edited scope is sufficient for both global and per-tenant saves.
  svc.invalidate(scope.tenantId);

  return ok(res, { saved: changes.length, tenant_id: scope.tenantId });
});
