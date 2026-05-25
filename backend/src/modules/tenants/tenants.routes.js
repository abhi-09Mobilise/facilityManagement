const router = require('express').Router();
const ctrl = require('./tenants.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);
router.use(requireRole('super_admin'));

router.get('/',        ctrl.list);
router.post('/',       ctrl.create);
router.get('/:id',     ctrl.getOne);
router.put('/:id',     ctrl.update);
router.delete('/:id',  ctrl.remove);

module.exports = router;
