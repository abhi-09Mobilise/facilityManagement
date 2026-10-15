const router = require('express').Router();
const ctrl = require('./dashboards.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);
router.use(requireRole('super_admin', 'tenant_admin'));

router.get('/tenant-admin',    ctrl.tenantAdmin);
router.get('/gantt',           ctrl.gantt);  // F08
router.get('/peak-times',      ctrl.peakTimes);      // SpaceDesk heatmap
router.get('/pantry-orders',   ctrl.pantryOrders);   // SpaceDesk pantry panel
router.get('/booking-channel', ctrl.bookingChannel); // SpaceDesk channel donut
router.get('/feedback',        ctrl.feedback);       // SpaceDesk feedback panel
router.get('/recent-activity', ctrl.recentActivity); // SpaceDesk activity feed

module.exports = router;
