// F06 - Pantries routes
const router = require('express').Router();
const ctrl = require('./pantries.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);

// Reads (employees can read for booking flow)
router.get('/',          ctrl.list);
router.get('/:id',       ctrl.getOne);
router.get('/:id/menu',  ctrl.listMenu);

// Writes - admins only
router.post('/',         requireRole('super_admin', 'tenant_admin'), ctrl.create);
router.put('/:id',       requireRole('super_admin', 'tenant_admin'), ctrl.update);
router.delete('/:id',    requireRole('super_admin', 'tenant_admin'), ctrl.remove);
router.put('/:id/menu',  requireRole('super_admin', 'tenant_admin'), ctrl.replaceMenu);

module.exports = router;
