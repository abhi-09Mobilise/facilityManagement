// Facility feedback ratings — authenticated submission from /my-bookings.
//
// Public (token-based) submission lives separately under /public/ratings
// so this file only guards the "logged-in user" entry point. Dashboard
// aggregation lives in the dashboards module.

const router = require('express').Router();
const ctrl = require('./ratings.controller');
const { authRequired } = require('../../middleware/auth');

router.use(authRequired);

router.get('/mine/:bookingId', ctrl.mineForBooking); // check if already rated
router.post('/',               ctrl.create);         // submit a rating

module.exports = router;
