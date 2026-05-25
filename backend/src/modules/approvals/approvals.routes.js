const router = require('express').Router();
const ctrl = require('./approvals.controller');
const { authRequired } = require('../../middleware/auth');

router.use(authRequired);

router.get('/inbox',       ctrl.inbox);
router.get('/history',     ctrl.history);
router.get('/by-token',    ctrl.byToken);
router.post('/:id/decide', ctrl.decide);

module.exports = router;
