const router = require('express').Router({ mergeParams: true });
const ctrl = require('./facilityChains.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);

router.get('/', ctrl.list);
router.put('/', requireRole('super_admin', 'tenant_admin'), ctrl.replace);

module.exports = router;
