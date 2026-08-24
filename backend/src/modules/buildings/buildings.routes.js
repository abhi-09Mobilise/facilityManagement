const router = require('express').Router();
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./buildings.controller');

router.use(authRequired);

router.get('/',        ctrl.list);
router.get('/:id',     ctrl.getOne);
router.post('/',       requireRole('super_admin', 'tenant_admin', 'org_admin'), ctrl.create);
router.put('/:id',     requireRole('super_admin', 'tenant_admin', 'org_admin'), ctrl.update);
router.delete('/:id',  requireRole('super_admin', 'tenant_admin'), ctrl.remove);

module.exports = router;
