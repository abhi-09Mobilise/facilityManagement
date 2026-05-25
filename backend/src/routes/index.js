// Top-level router. Each module owns its own routes file + role guards.

const express = require('express');
const router = express.Router();

router.use('/auth', require('../modules/auth/auth.routes'));

// Super-admin owned
router.use('/tenants', require('../modules/tenants/tenants.routes'));
router.use('/lookups', require('../modules/lookups/lookups.routes'));

// Tenant-admin owned (super_admin can target any tenant)
router.use('/users',              require('../modules/users/users.routes'));
router.use('/sites',              require('../modules/sites/sites.routes'));
router.use('/floors',             require('../modules/floors/floors.routes'));
router.use('/facilities',         require('../modules/facilities/facilities.routes'));
router.use('/departments',        require('../modules/departments/departments.routes'));
router.use('/meal-times',         require('../modules/mealTimes/mealTimes.routes'));
router.use('/pantries',           require('../modules/pantries/pantries.routes'));  // F06

// Bookings (employee-driven) + approvals inbox
router.use('/bookings',  require('../modules/bookings/bookings.routes'));
router.use('/approvals', require('../modules/approvals/approvals.routes'));

// Admin dashboards (super_admin + tenant_admin)
router.use('/dashboards', require('../modules/dashboards/dashboards.routes'));

router.get('/health', function (_req, res) {
  return res.json({ status: true, msg: 'ok' });
});

module.exports = router;
