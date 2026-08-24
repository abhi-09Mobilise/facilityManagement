// Organisation-scoping helpers, mirroring tenantScope.js.
//
// Rule of thumb after Stage 1 migrations added the org layer:
//   - super_admin   → sees any tenant, any org. May pass ?organisation_id=N
//                     as an override; empty query = cross-org view.
//   - tenant_admin  → sees any org within their own tenant. Same override
//                     support (empty = cross-org within the tenant).
//   - org_admin     → hard-scoped to req.user.organisation_id. Any org override
//                     from the client is IGNORED for safety — the JWT wins.
//   - approver /    → same as org_admin: single-org read/write.
//     employee
//
// Use effectiveOrgId() for INSERTs; scopeOrgWhere() for SELECT WHERE clauses;
// assertOrgScope() to verify a row before mutating it.

const { query } = require('../db/pool');
const { intOrNull } = require('./tenantScope');

/**
 * Resolves the organisation_id this request is operating against.
 *   - super_admin  → override wins (may be null)
 *   - tenant_admin → override wins (may be null; they can act cross-org
 *                    within their own tenant)
 *   - others       → always req.user.organisation_id (server-forced)
 */
function effectiveOrgId(req, overrideRaw) {
  if (req.user.role === 'super_admin' || req.user.role === 'tenant_admin') {
    return intOrNull(overrideRaw);
  }
  return req.user.organisation_id || null;
}

/**
 * Returns a WHERE-clause fragment + params that scope a SELECT to the
 * caller's organisation. For super_admin and tenant_admin this is open
 * (no scope) unless they passed ?organisation_id=N. For everyone else
 * it's a hard filter on their own org.
 *
 *   const { sql, params } = scopeOrgWhere(req, 's.organisation_id');
 *   const rows = await query('SELECT ... WHERE 1=1 ' + sql, params);
 */
function scopeOrgWhere(req, column = 'organisation_id') {
  if (req.user.role === 'super_admin' || req.user.role === 'tenant_admin') {
    const oid = intOrNull(req.query.organisation_id);
    if (oid === null) return { sql: '', params: [] };
    return { sql: ' AND ' + column + ' = ?', params: [oid] };
  }
  const own = req.user.organisation_id || null;
  if (own === null) {
    // Defensive: an org-scoped role with no org would otherwise see everything
    // in the tenant. Force an impossible predicate instead.
    return { sql: ' AND 1 = 0', params: [] };
  }
  return { sql: ' AND ' + column + ' = ?', params: [own] };
}

/**
 * Loads a row by id and asserts it belongs to the caller's organisation
 * (for org-scoped roles). tenant_admin and super_admin bypass the org check
 * — their tenant scope is enforced separately by assertOwnership().
 *
 *   const r = await assertOrgScope(req, 'sites', id);
 *   if (!r.ok) return fail(res, r.msg, r.status);
 */
async function assertOrgScope(req, table, id, idColumn = 'id') {
  const rows = await query(
    'SELECT * FROM `' + table + '` WHERE `' + idColumn + '` = ? LIMIT 1',
    [id]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, msg: 'Not found' };
  }
  const row = rows[0];
  const role = req.user.role;
  if (role === 'super_admin' || role === 'tenant_admin') {
    return { ok: true, row };
  }
  // org-scoped roles: row must match caller's organisation_id
  if (row.organisation_id !== req.user.organisation_id) {
    return { ok: false, status: 403, msg: 'Forbidden' };
  }
  return { ok: true, row };
}

module.exports = {
  intOrNull,
  effectiveOrgId,
  scopeOrgWhere,
  assertOrgScope,
};
