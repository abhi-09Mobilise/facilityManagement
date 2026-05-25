const router = require('express').Router();
const ctrl = require('./mealTimes.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);

// List - any logged-in user (employees see meal options when booking).
router.get('/', ctrl.list);

// Writes - admins only.
router.post('/',      requireRole('super_admin', 'tenant_admin'), ctrl.create);
router.put('/:id',    requireRole('super_admin', 'tenant_admin'), ctrl.update);
router.delete('/:id', requireRole('super_admin', 'tenant_admin'), ctrl.remove);

module.exports = router;
