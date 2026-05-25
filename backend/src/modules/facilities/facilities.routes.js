const router = require('express').Router();
const ctrl = require('./facilities.controller');
const chainRouter = require('../facilityChains/facilityChains.routes');
const facilityPantriesCtrl = require('./facilityPantries.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);

// List/get are open to any logged-in user (employees browse facilities).
router.get('/',          ctrl.list);
router.get('/:id',       ctrl.getOne);
router.get('/:id/hours', ctrl.listHours);

// Writes - admins only.
router.post('/',         requireRole('super_admin', 'tenant_admin'), ctrl.create);
router.put('/:id',       requireRole('super_admin', 'tenant_admin'), ctrl.update);
router.delete('/:id',    requireRole('super_admin', 'tenant_admin'), ctrl.remove);
router.put('/:id/hours', requireRole('super_admin', 'tenant_admin'), ctrl.replaceHours);

// Nested approval chain (GET open to any logged-in user, PUT admin-only).
router.use('/:id/chain', chainRouter);

// F01 - per-slot capacity overrides (GET open, PUT admin)
router.use('/:id/slot-capacities', require('./slotOverrides.routes'));

// F06 - pantry linkage + booking menu
router.use('/:id/pantries', require('./facilityPantries.routes'));
router.get('/:id/menu', facilityPantriesCtrl.menuForBooking);

module.exports = router;
