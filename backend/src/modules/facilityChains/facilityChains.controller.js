// Per-facility approval chain management.
//
//   GET /api/facilities/:id/chain?stage=checkin|checkout  - load that stage's chain
//   PUT /api/facilities/:id/chain?stage=checkin|checkout  - replace that stage's chain
//
// Body for PUT:
//   { steps: [
//       { approver_kind: 'dynamic_dept_manager' },
//       { approver_kind: 'user', approver_user_id: 42 },
//       ...
//   ] }
//
// step_order is implicit (array index + 1). The whole stage's chain is
// replaced atomically. F02 added the stage qualifier so the same machinery
// handles both check-in (pre-booking) and check-out (post-booking) flows.

const { query, withTransaction } = require('../../db/pool');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull, assertOwnership } = require('../../utils/tenantScope');
const facilitiesCtrl = require('../facilities/facilities.controller');

const VALID_KINDS = ['user', 'dynamic_dept_manager'];

function stageFrom(req) {
  return req.query.stage === 'checkout' ? 'checkout' : 'checkin';
}

exports.list = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid facility id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  const rows = await facilitiesCtrl._loadChain(id, stageFrom(req));
  return ok(res, rows);
});

exports.replace = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid facility id', 400);
  const r = await assertOwnership(req, 'facilities', id);
  if (!r.ok) return fail(res, r.msg, r.status);
  const stage = stageFrom(req);

  const steps = Array.isArray(req.body && req.body.steps) ? req.body.steps : null;
  if (steps === null) return fail(res, 'steps[] is required', 422);

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] || {};
    if (!VALID_KINDS.includes(s.approver_kind)) {
      return fail(res, `steps[${i}].approver_kind must be one of: ${VALID_KINDS.join(', ')}`, 422);
    }
    if (s.approver_kind === 'user') {
      const uid = intOrNull(s.approver_user_id);
      if (uid === null) return fail(res, `steps[${i}].approver_user_id is required for 'user' kind`, 422);
      const rows = await query(
        'SELECT id FROM `users` WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
        [uid, r.row.tenant_id]
      );
      if (rows.length === 0) {
        return fail(res, `steps[${i}].approver_user_id is not a valid user in this tenant`, 422);
      }
    }
  }

  await withTransaction(async function (conn) {
    await conn.execute(
      'DELETE FROM `facility_approval_chains` WHERE facility_id = ? AND stage = ?',
      [id, stage]
    );
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await conn.execute(
        'INSERT INTO `facility_approval_chains` ' +
        '  (facility_id, stage, step_order, approver_kind, approver_user_id) ' +
        'VALUES (?, ?, ?, ?, ?)',
        [
          id, stage, i + 1, s.approver_kind,
          s.approver_kind === 'user' ? intOrNull(s.approver_user_id) : null,
        ]
      );
    }
  });

  return ok(res, null, `Approval chain saved (${stage})`);
});
