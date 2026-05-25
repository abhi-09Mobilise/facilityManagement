const router = require('express').Router();
const ctrl = require('./bookings.controller');
const { authRequired } = require('../../middleware/auth');

router.use(authRequired);

router.post('/',           ctrl.create);
router.get('/',            ctrl.list);
router.get('/check',       ctrl.check);   // pre-flight conflict probe
router.get('/:id',         ctrl.getOne);
router.post('/:id/cancel', ctrl.cancel);

// F07 - reschedule / cancel via mail
router.get('/:id/act',         ctrl.actByToken);  // ?token=&action=cancel|reschedule
router.post('/:id/reschedule', ctrl.reschedule);  // body: { token, start_at, end_at }

module.exports = router;
