// F01 - slot-capacity routes, mounted under /api/facilities/:id/slot-capacities
//
// GET is open to logged-in users so the booking page can show min/max info.
// PUT is admin-only (super_admin + tenant_admin).
//
// We use mergeParams so :id from the parent router is available here.

const router = require('express').Router({ mergeParams: true });
const ctrl = require('./slotOverrides.controller');
const { requireRole } = require('../../middleware/auth');

router.get('/', ctrl.list);
router.put('/', requireRole('super_admin', 'tenant_admin'), ctrl.replace);

module.exports = router;
