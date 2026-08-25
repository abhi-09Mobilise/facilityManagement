// Roles & permissions matrix routes.
//
// /effective is open to every signed-in user (drives frontend nav/gating).
// /catalog + /matrix require roles.manage, which the controller checks via
// the resolved matrix itself (so a tenant admin who has been stripped of
// roles.manage loses access here too). requireRole narrows the surface to
// admin roles before the permission check runs.

const express = require('express');
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./permissions.controller');

const router = express.Router();

router.use(authRequired);

router.get('/effective', ctrl.effective);
router.get('/catalog', requireRole('super_admin', 'tenant_admin'), ctrl.catalog);
router.get('/matrix', requireRole('super_admin', 'tenant_admin'), ctrl.getMatrix);
router.put('/matrix', requireRole('super_admin', 'tenant_admin'), ctrl.saveMatrix);

module.exports = router;
