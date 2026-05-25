// F06 - facility <-> pantries mount, parent passes :id
const router = require('express').Router({ mergeParams: true });
const ctrl = require('./facilityPantries.controller');
const { requireRole } = require('../../middleware/auth');

router.get('/', ctrl.list);
router.put('/', requireRole('super_admin', 'tenant_admin'), ctrl.replace);

module.exports = router;
