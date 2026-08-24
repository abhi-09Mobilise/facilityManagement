const router = require('express').Router();
const ctrl = require('./sites.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);
// org_admin can list/get/create/update sites within their own org; delete stays
// tenant-admin-only so an org_admin can't wipe out live infrastructure.
router.use(requireRole('super_admin', 'tenant_admin', 'org_admin'));

router.get('/',        ctrl.list);
router.post('/',       ctrl.create);
router.get('/:id',     ctrl.getOne);
router.put('/:id',     ctrl.update);
router.delete('/:id',  requireRole('super_admin', 'tenant_admin'), ctrl.remove);

module.exports = router;
