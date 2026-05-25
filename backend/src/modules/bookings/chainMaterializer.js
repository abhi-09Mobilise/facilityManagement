// Per-booking approval chain materializer.
//
// Replaces the old workflowMatcher.js (deleted in migration 019). Given a
// freshly-inserted booking + its facility + booker, this:
//   1. loads the facility's chain rows for the given stage (in step_order)
//   2. resolves each row to a concrete approver_user_id:
//        - 'user'                 -> the row's approver_user_id directly
//        - 'dynamic_dept_manager' -> booker.department_id -> dept.manager_user_id,
//                                    falling back to any active tenant_admin
//   3. inserts one booking_approvals row per step with the chosen stage
//   4. returns the first approver's id (for the first email send)
//
// F02 added the `stage` arg (default 'checkin' for backwards compatibility).
// Pass 'checkout' for the post-end approval workflow.

async function loadChain(conn, facilityId, stage) {
  const [rows] = await conn.execute(
    'SELECT step_order, approver_kind, approver_user_id ' +
    '  FROM `facility_approval_chains` WHERE facility_id = ? AND stage = ? ORDER BY step_order',
    [facilityId, stage]
  );
  return rows;
}

async function resolveDeptManager(conn, departmentId) {
  if (!departmentId) return null;
  const [rows] = await conn.execute(
    'SELECT manager_user_id FROM `departments` WHERE id = ? LIMIT 1',
    [departmentId]
  );
  return rows.length > 0 ? rows[0].manager_user_id : null;
}

async function pickFallbackTenantAdmin(conn, tenantId) {
  const [rows] = await conn.execute(
    "SELECT id FROM `users` " +
    " WHERE tenant_id = ? AND role = 'tenant_admin' " +
    "   AND trash = 0 AND status = 1 " +
    " ORDER BY id ASC LIMIT 1",
    [tenantId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function isActiveUserInTenant(conn, userId, tenantId) {
  if (!userId) return false;
  const [rows] = await conn.execute(
    'SELECT id FROM `users` WHERE id = ? AND tenant_id = ? AND trash = 0 AND status = 1 LIMIT 1',
    [userId, tenantId]
  );
  return rows.length > 0;
}

/**
 * Materialize the chain for a booking at a given stage.
 *
 * Returns { stage, stepsCreated, firstApproverId, firstApprovalId, materialized: [...] }
 */
async function materializeChain({ conn, bookingId, facility, booker, stage }) {
  const stageVal = stage === 'checkout' ? 'checkout' : 'checkin';
  const chain = await loadChain(conn, facility.id, stageVal);
  if (chain.length === 0) {
    return { stage: stageVal, stepsCreated: 0, firstApproverId: null, firstApprovalId: null, materialized: [] };
  }

  let firstApproverId = null;
  let firstApprovalId = null;
  let stepsCreated = 0;
  const materialized = [];

  for (const step of chain) {
    let approverId = null;
    let resolutionNote = null;

    if (step.approver_kind === 'user') {
      const eligible = await isActiveUserInTenant(conn, step.approver_user_id, booker.tenant_id);
      if (eligible) approverId = step.approver_user_id;
      else resolutionNote = 'Configured user no longer active in tenant';
    } else if (step.approver_kind === 'dynamic_dept_manager') {
      const mgrId = await resolveDeptManager(conn, booker.department_id);
      if (mgrId && (await isActiveUserInTenant(conn, mgrId, booker.tenant_id))) {
        approverId = mgrId;
      } else {
        const adminId = await pickFallbackTenantAdmin(conn, booker.tenant_id);
        if (adminId) {
          approverId = adminId;
          resolutionNote = 'No department manager - routed to tenant admin';
        } else {
          resolutionNote = 'No department manager and no tenant admin available';
        }
      }
    }

    if (approverId === null) {
      const [r] = await conn.execute(
        'INSERT INTO `booking_approvals` ' +
        '  (booking_id, stage, step_id, step_order, approver_user_id, decision, remark, decided_at) ' +
        " VALUES (?, ?, NULL, ?, 0, 'approved', ?, NOW())",
        [bookingId, stageVal, step.step_order, 'Auto-approved: ' + (resolutionNote || 'no approver could be resolved')]
      );
      materialized.push({
        step_order: step.step_order, kind: step.approver_kind,
        approver_user_id: null, approval_id: r.insertId, autoApproved: true, note: resolutionNote,
      });
      continue;
    }

    const [r] = await conn.execute(
      'INSERT INTO `booking_approvals` ' +
      '  (booking_id, stage, step_id, step_order, approver_user_id, decision) ' +
      " VALUES (?, ?, NULL, ?, ?, 'pending')",
      [bookingId, stageVal, step.step_order, approverId]
    );
    stepsCreated++;
    materialized.push({
      step_order: step.step_order, kind: step.approver_kind,
      approver_user_id: approverId, approval_id: r.insertId, autoApproved: false, note: resolutionNote,
    });
    if (firstApproverId === null) {
      firstApproverId = approverId;
      firstApprovalId = r.insertId;
    }
  }

  return { stage: stageVal, stepsCreated, firstApproverId, firstApprovalId, materialized };
}

module.exports = { materializeChain };
