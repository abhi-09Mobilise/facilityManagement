// Approvals inbox + decide + by-token resolver.
//
// Endpoints:
//   GET  /api/approvals/inbox        - my pending approvals (any step, not just "my turn")
//   GET  /api/approvals/history      - my past decisions
//   GET  /api/approvals/by-token     - resolve ?token=... to one approval row (after RBAC match)
//   POST /api/approvals/:id/decide   - approve or reject one step
//
// Decision flow (chosen: "Continue on reject"):
//   - Every step's approver gets emailed in turn, regardless of prior reject.
//   - Booking status only finalises when ALL rows have decided:
//        any reject → 'rejected'
//        all approve → 'approved'
//   - The token in the email only identifies the row; the decide endpoint
//     still requires req.user.id === approver_user_id (or super_admin).

const { query, execute, withTransaction } = require('../../db/pool');
const { ok, fail, notFound } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { intOrNull } = require('../../utils/tenantScope');
const { consumeToken, markUsed, issueToken } = require('../../utils/approvalActionTokens');
const bookingsCtrl = require('../bookings/bookings.controller');

// "My pending" - any step assigned to me that's still pending. We no longer
// hide steps where an earlier step is still pending, because the new model
// emails every approver in sequence (continue-on-reject).
const INBOX_SQL =
  'SELECT ba.id, ba.booking_id, ba.stage, ba.step_id, ba.approver_user_id, ba.step_order, ' +
  '       ba.decision, ba.decided_at, ' +
  '       b.title, b.start_at, b.end_at, b.status AS booking_status, b.checkout_status, b.remarks, ' +
  '       f.name AS facility_name, f.type AS facility_type, ' +
  '       u.id AS booker_id, u.name AS booker_name, u.lname AS booker_lname, u.username AS booker_username ' +
  '  FROM `booking_approvals` ba ' +
  '  INNER JOIN `bookings`   b ON b.id = ba.booking_id ' +
  '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
  '  INNER JOIN `users`      u ON u.id = b.user_id ' +
  " WHERE ba.approver_user_id = ? AND ba.decision = 'pending' " +
  '   AND b.trash = 0 ' +
  ' ORDER BY ba.step_order ASC, ba.id ASC';

exports.inbox = asyncHandler(async function (req, res) {
  const rows = await query(INBOX_SQL, [req.user.id]);
  return ok(res, rows);
});

exports.history = asyncHandler(async function (req, res) {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10)));
  const rows = await query(
    'SELECT ba.id, ba.booking_id, ba.decision, ba.remark, ba.decided_at, ba.step_order, ' +
    '       b.title, b.start_at, b.end_at, b.status AS booking_status, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.name AS booker_name, u.lname AS booker_lname ' +
    '  FROM `booking_approvals` ba ' +
    '  INNER JOIN `bookings`   b ON b.id = ba.booking_id ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    " WHERE ba.approver_user_id = ? AND ba.decision != 'pending' " +
    ` ORDER BY ba.decided_at DESC LIMIT ${limit}`,
    [req.user.id]
  );
  return ok(res, rows);
});

// GET /api/approvals/by-token?token=...
// Resolves a one-time token from an approver email. Token alone is NOT
// enough - we additionally require the logged-in user to be the approver
// assigned to that row (or super_admin). Token is NOT consumed here -
// it's only consumed when the decide endpoint completes successfully.
exports.byToken = asyncHandler(async function (req, res) {
  const token = String(req.query.token || '').trim();
  if (!token) return fail(res, 'token is required', 422);

  const tokenRow = await consumeToken(token);
  if (!tokenRow) return fail(res, 'This link is invalid or has expired', 400);

  const rows = await query(
    'SELECT ba.id, ba.booking_id, ba.step_id, ba.step_order, ba.approver_user_id, ' +
    '       ba.decision, ba.remark, ba.decided_at, ' +
    '       b.tenant_id, b.title, b.start_at, b.end_at, b.status AS booking_status, ' +
    '       b.remarks AS booking_remarks, ' +
    '       f.name AS facility_name, f.type AS facility_type, ' +
    '       u.id AS booker_id, u.name AS booker_name, u.lname AS booker_lname, ' +
    '       u.username AS booker_username, u.email AS booker_email ' +
    '  FROM `booking_approvals` ba ' +
    '  INNER JOIN `bookings`   b ON b.id = ba.booking_id ' +
    '  INNER JOIN `facilities` f ON f.id = b.facility_id ' +
    '  INNER JOIN `users`      u ON u.id = b.user_id ' +
    ' WHERE ba.id = ? LIMIT 1',
    [tokenRow.booking_approval_id]
  );
  if (rows.length === 0) return notFound(res, 'Approval not found');
  const row = rows[0];

  // Strict RBAC: the logged-in user must be the assigned approver, or a
  // super_admin (cross-tenant maintenance access). Token alone never lets
  // anyone else act.
  if (row.approver_user_id !== req.user.id && req.user.role !== 'super_admin') {
    return fail(res, 'Forbidden - this approval is not assigned to you', 403);
  }

  // Also surface prior decisions so the act page can show the chain history.
  const priors = await query(
    'SELECT ba.id, ba.step_order, ba.decision, ba.remark, ba.decided_at, ' +
    '       u.name AS approver_name, u.lname AS approver_lname ' +
    '  FROM `booking_approvals` ba ' +
    '  LEFT JOIN `users` u ON u.id = ba.approver_user_id ' +
    ' WHERE ba.booking_id = ? AND ba.id <> ? ' +
    ' ORDER BY ba.step_order',
    [row.booking_id, row.id]
  );

  return ok(res, { approval: row, prior_decisions: priors });
});

exports.decide = asyncHandler(async function (req, res) {
  const id = intOrNull(req.params.id);
  if (id === null) return fail(res, 'Invalid id', 400);

  const decision = String((req.body && req.body.decision) || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    return fail(res, "decision must be 'approved' or 'rejected'", 422);
  }
  const remark = (req.body && req.body.remark) || null;
  const consumeTokenRaw = (req.body && req.body.token) || null;

  const rows = await query(
    'SELECT ba.id, ba.booking_id, ba.stage, ba.step_id, ba.step_order, ba.approver_user_id, ba.decision, ' +
    '       b.tenant_id ' +
    '  FROM `booking_approvals` ba ' +
    '  INNER JOIN `bookings` b ON b.id = ba.booking_id ' +
    ' WHERE ba.id = ? LIMIT 1',
    [id]
  );
  if (rows.length === 0) return notFound(res, 'Approval not found');
  const row = rows[0];

  // Strict RBAC: only the assigned approver can act. super_admin override
  // kept for support / maintenance.
  if (row.approver_user_id !== req.user.id && req.user.role !== 'super_admin') {
    return fail(res, 'Forbidden - this approval is not assigned to you', 403);
  }
  if (row.decision !== 'pending') {
    return fail(res, `Already ${row.decision}`, 422);
  }

  // Find the next pending step (if any) so we can email its approver after
  // this transaction commits. We also recompute booking status by aggregating
  // the full set of decisions (continue-on-reject model).
  let nextApprovalRow = null;
  let finalStatusForEmail = null;     // F07 - booking_id if final status flipped to approved
  let finalStatusForBooker = null;    // 'approved' | 'rejected' | null - drives the booker step email
  let bookingIdForBookerEmail = row.booking_id;
  await withTransaction(async function (conn) {
    await conn.execute(
      'UPDATE `booking_approvals` SET decision = ?, remark = ?, decided_at = NOW() WHERE id = ?',
      [decision, remark, id]
    );

    // Recompute booking status from the full set of rows AT THIS STAGE only.
    // F02 - check-in approvals finalise b.status; check-out approvals finalise
    // b.checkout_status. The two flows are independent.
    const stage = row.stage || 'checkin';
    const [counts] = await conn.execute(
      "SELECT " +
      "  SUM(CASE WHEN decision = 'pending'  THEN 1 ELSE 0 END) AS pending_cnt, " +
      "  SUM(CASE WHEN decision = 'rejected' THEN 1 ELSE 0 END) AS rejected_cnt, " +
      "  COUNT(*) AS total " +
      "  FROM `booking_approvals` WHERE booking_id = ? AND stage = ?",
      [row.booking_id, stage]
    );
    const { pending_cnt, rejected_cnt } = counts[0];
    if (Number(pending_cnt) === 0) {
      const finalStatus = Number(rejected_cnt) > 0 ? 'rejected' : 'approved';
      if (stage === 'checkout') {
        await conn.execute(
          'UPDATE `bookings` SET checkout_status = ? WHERE id = ?',
          [finalStatus, row.booking_id]
        );
      } else {
        await conn.execute('UPDATE `bookings` SET status = ? WHERE id = ?', [finalStatus, row.booking_id]);
        if (finalStatus === 'approved') finalStatusForEmail = row.booking_id;
        // Track final status for the booker step-decision email (only
        // checkin stage; checkout decisions don't change booking status).
        finalStatusForBooker = finalStatus;
      }
    }

    // Pick the next pending row at THIS stage (continue-on-reject).
    const [nextRows] = await conn.execute(
      "SELECT id, approver_user_id, step_order " +
      "  FROM `booking_approvals` " +
      " WHERE booking_id = ? AND stage = ? AND decision = 'pending' AND step_order > ? " +
      " ORDER BY step_order ASC, id ASC LIMIT 1",
      [row.booking_id, stage, row.step_order]
    );
    if (nextRows.length > 0) nextApprovalRow = nextRows[0];
  });

  // Consume the action token if one was passed (used when acting from email).
  if (consumeTokenRaw) {
    try {
      const tokenRow = await consumeToken(consumeTokenRaw);
      // Token is single-use - mark it used now even if it didn't strictly map
      // to this row (defensive).
      if (tokenRow && tokenRow.booking_approval_id === id) {
        await markUsed(tokenRow.id);
      }
    } catch (e) {
      console.error('[approvals.decide] token consume failed:', e && e.message);
    }
  }

  // Fire-and-forget email to the next step's approver, outside the txn.
  if (nextApprovalRow && nextApprovalRow.approver_user_id) {
    (async () => {
      try {
        const token = await issueToken(nextApprovalRow.id);
        await bookingsCtrl._sendApprovalEmailWithToken({
          approvalId: nextApprovalRow.id,
          token,
        });
      } catch (e) {
        console.error('[approvals.decide] next-step email failed:', e && e.message);
      }
    })();
  }

  // F07 - if THIS decision finalised the booking as approved, send confirmation
  // email (with reschedule + cancel links) to the booker.
  // F09 - also fan out FYI emails to the facility notification recipients.
  if (finalStatusForEmail) {
    (async () => {
      try {
        await bookingsCtrl._sendBookingConfirmedEmail(finalStatusForEmail);
      } catch (e) {
        console.error('[approvals.decide] confirm email failed:', e && e.message);
      }
      try { await bookingsCtrl._sendFacilityNotifications(finalStatusForEmail, 'approved'); }
      catch (e) { console.error('[approvals.decide] notify failed:', e && e.message); }
    })();
  }

  // Always fire a step-decision email to the booker so they see the chain
  // progressing in real time. Skipped for checkout-stage decisions (which
  // don't change booking status and the booker doesn't care about). The
  // final-approved case also gets the rich bookingConfirmed email above;
  // this lighter email is fine alongside since it covers the chain summary.
  if ((row.stage || 'checkin') === 'checkin') {
    (async () => {
      try {
        await bookingsCtrl._sendBookingStepDecisionEmail({
          approvalId: id,
          finalStatus: finalStatusForBooker,  // null = chain still in progress
        });
      } catch (e) {
        console.error('[approvals.decide] booker step email failed:', e && e.message);
      }
    })();
  }
  // bookingIdForBookerEmail kept around for future use (e.g. logging).
  void bookingIdForBookerEmail;

  return ok(res, null, `Decision recorded: ${decision}`);
});
