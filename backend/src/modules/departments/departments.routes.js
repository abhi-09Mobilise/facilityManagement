const router = require('express').Router();
const ctrl = require('./departments.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);
router.use(requireRole('super_admin', 'tenant_admin'));

router.get('/',       ctrl.list);
router.post('/',      ctrl.create);
router.put('/:id',    ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
