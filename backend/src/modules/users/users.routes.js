const router = require('express').Router();
const ctrl = require('./users.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

// Everything needs auth.
router.use(authRequired);

// Self-service endpoints (any logged-in role) - placed BEFORE the admin gate.
router.get('/me-summary', ctrl.meSummary);

// Admin-only from here on. org_admin can manage their own org's users; the
// controller enforces the tighter role-assignment matrix for them.
router.use(requireRole('super_admin', 'tenant_admin', 'org_admin'));

router.get('/approvers', ctrl.approvers);
router.get('/',          ctrl.list);
router.post('/',         ctrl.create);
router.put('/',          ctrl.update);
router.delete('/',       ctrl.remove);

// Single-user fetch - put LAST so other paths aren't shadowed.
router.get('/:id',       ctrl.getOne);

module.exports = router;
