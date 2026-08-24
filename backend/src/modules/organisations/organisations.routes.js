// Routes for /api/organisations — the new layer between Tenant and Sites.
// See organisations.controller.js for per-handler RBAC notes; the guards
// here only stop obviously wrong roles at the door (create/delete/admin
// management require tenant_admin or super_admin). Everything else lets the
// controller decide because org_admin has partial rights on their own org.

const router = require('express').Router();
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./organisations.controller');

router.use(authRequired);

router.get('/',                       ctrl.list);
router.get('/:id',                    ctrl.getOne);
router.post('/',                      requireRole('super_admin', 'tenant_admin'), ctrl.create);
router.put('/:id',                    ctrl.update);
router.delete('/:id',                 requireRole('super_admin', 'tenant_admin'), ctrl.remove);

router.get('/:id/admins',             ctrl.listAdmins);
router.post('/:id/admins',            requireRole('super_admin', 'tenant_admin'), ctrl.addAdmin);
router.delete('/:id/admins/:userId',  requireRole('super_admin', 'tenant_admin'), ctrl.removeAdmin);

module.exports = router;
