const router = require('express').Router();
const ctrl = require('./users.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

// Everything needs auth.
router.use(authRequired);

// Self-service endpoints (any logged-in role) - placed BEFORE the admin gate.
router.get('/me-summary', ctrl.meSummary);

// Admin-only from here on.
router.use(requireRole('super_admin', 'tenant_admin'));

router.get('/approvers', ctrl.approvers);
router.get('/',          ctrl.list);
router.post('/',         ctrl.create);
router.put('/',          ctrl.update);
router.delete('/',       ctrl.remove);

// Single-user fetch - put LAST so other paths aren't shadowed.
router.get('/:id',       ctrl.getOne);

module.exports = router;
