const router = require('express').Router();
const ctrl = require('./lookups.controller');
const { authRequired, requireRole } = require('../../middleware/auth');

router.use(authRequired);

// Reads - any authenticated user (used by tenant signup / settings UIs)
router.get('/currencies', ctrl.listCurrencies);
router.get('/timezones',  ctrl.listTimezones);
router.get('/locales',    ctrl.listLocales);

// Writes - super_admin only
router.post('/currencies',       requireRole('super_admin'), ctrl.createCurrency);
router.put('/currencies/:code',  requireRole('super_admin'), ctrl.updateCurrency);
router.post('/timezones',        requireRole('super_admin'), ctrl.createTimezone);
router.post('/locales',          requireRole('super_admin'), ctrl.createLocale);

module.exports = router;
