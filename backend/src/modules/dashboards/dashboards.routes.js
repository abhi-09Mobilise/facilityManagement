const router = require('express').Router();
const ctrl = require('./dashboards.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);
router.use(requireRole('super_admin', 'tenant_admin'));

router.get('/tenant-admin', ctrl.tenantAdmin);
router.get('/gantt',        ctrl.gantt);  // F08

module.exports = router;
