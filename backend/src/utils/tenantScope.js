// Tenant-scoping helpers used by every tenant-scoped controller.
//
// Rule: a tenant_admin / employee can only see/mutate rows where
//       tenant_id === req.user.tenant_id. A super_admin can target any
//       tenant by passing tenant_id via body or query.

const { query } = require('../db/pool');
const { fail } = require('./response');

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Resolves the tenant_id this request is operating against.
 *   - super_admin → uses the passed override (body or query); may be null
 *   - others      → always req.user.tenant_id (ignores any override)
 *
 * Use the result for INSERTs and as the WHERE filter for SELECTs.
 */
function effectiveTenantId(req, override) {
  if (req.user.role === 'super_admin') {
    return intOrNull(override);
  }
  return req.user.tenant_id;
}

/**
 * Returns a WHERE-clause fragment + params that scope a SELECT to the
 * caller's tenant. For super admins this is open (no scope) unless they
 * passed ?tenant_id=N.
 *
 *   const { sql, params } = scopeWhere(req, 'tenant_id');
 *   const rows = await query(`SELECT * FROM foo WHERE 1=1 ${sql}`, [...otherParams, ...params]);
 */
function scopeWhere(req, column = 'tenant_id') {
  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid === null) return { sql: '', params: [] };
    return { sql: ` AND ${column} = ?`, params: [tid] };
  }
  return { sql: ` AND ${column} = ?`, params: [req.user.tenant_id] };
}

/**
 * Loads a row by id and asserts it belongs to the caller's tenant.
 * Returns { ok: true, row } on success, { ok: false, status, msg } on failure.
 *
 *   const r = await assertOwnership(req, 'sites', id);
 *   if (!r.ok) return fail(res, r.msg, r.status);
 */
async function assertOwnership(req, table, id, idColumn = 'id') {
  const rows = await query(
    `SELECT * FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
    [id]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, msg: 'Not found' };
  }
  const row = rows[0];
  if (req.user.role !== 'super_admin' && row.tenant_id !== req.user.tenant_id) {
    return { ok: false, status: 403, msg: 'Forbidden' };
  }
  return { ok: true, row };
}

/**
 * Same as assertOwnership but checks ownership transitively via a parent row.
 * Useful for sub-resources: e.g. a `facility_operating_hours` row's tenant
 * is read off `facilities.tenant_id`.
 */
async function assertOwnershipVia(req, parentTable, parentId) {
  return assertOwnership(req, parentTable, parentId);
}

module.exports = {
  intOrNull,
  effectiveTenantId,
  scopeWhere,
  assertOwnership,
  assertOwnershipVia,
};
