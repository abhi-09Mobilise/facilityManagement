// Meal-times CRUD - tenant_admin (own) or super_admin (any).
// Employees can READ to populate the prebook-meal picker on a booking.

const { query, execute } = require('../../db/pool');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, effectiveTenantId, assertOwnership } = require('../../utils/tenantScope');

exports.list = asyncHandler(async function (req, res) {
  const where = ['trash = 0', 'status = 1'];
  const params = [];

  if (req.user.role === 'super_admin') {
    const tid = intOrNull(req.query.tenant_id);
    if (tid !== null) { where.push('tenant_id = ?'); params.push(tid); }
  } else {
    where.push('tenant_id = ?');
    params.push(req.user.tenant_id);
  }

  const rows = await query(
    'SELECT id, tenant_id, name, start_time, end_time, status ' +
    '  FROM `meal_times` WHERE ' + where.join(' AND ') +
    ' ORDER BY start_time',
    params
  );
  return ok(res, rows);
});

exports.create = asyncHandler(async function (req, res) {
  const b = req.body || {};
  if (!b.name) return fail(res, 'name is required', 422);
  if (!b.start_time || !b.end_time) {
    return fail(res, 'start_time and end_time are required (HH:MM)', 422);
  }
  const tenantId = effectiveTenantId(req, b.tenant_id);
  if (tenantId === null) return fail(res, 'tenant_id is required', 422);

  const r = await execute(
    'INSERT INTO `meal_times` (tenant_id, name, start_time, end_time) VALUES (?, ?, ?, ?)',
    [tenantId, b.name, b.start_time, b.end_time]
  );
  return created(res, { id: r.insertId }, 'Meal time created');
});

exports.update = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'meal_times', id);
  if (!r.ok) return fail(res, r.msg, r.status);

  const b = req.body || {};
  await execute(
    'UPDATE `meal_times` SET ' +
    '  name       = COALESCE(?, name), ' +
    '  start_time = COALESCE(?, start_time), ' +
    '  end_time   = COALESCE(?, end_time), ' +
    '  status     = COALESCE(?, status) ' +
    'WHERE id = ?',
    [b.name || null, b.start_time || null, b.end_time || null, intOrNull(b.status), id]
  );
  return ok(res, null, 'Meal time updated');
});

exports.remove = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);
  const r = await assertOwnership(req, 'meal_times', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  await execute('UPDATE `meal_times` SET trash = 1 WHERE id = ?', [id]);
  return ok(res, null, 'Meal time deleted');
});
