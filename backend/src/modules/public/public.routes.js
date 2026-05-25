// F03 - public portal router. NOT mounted behind authRequired.
//
// Routes:
//   GET /public/t/:slug
//   GET /public/t/:slug/sites
//   GET /public/t/:slug/sites/:siteId/facilities
//   GET /public/t/:slug/facilities/:id
//
// Lightweight rate-limit: 120 requests / minute / IP. We don't pull in
// express-rate-limit to avoid an extra dep - a tiny in-memory bucket is
// enough for early traffic. Replace with a real limiter when needed.

const router = require('express').Router();
const ctrl = require('./public.controller');

const buckets = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 1000;
const LIMIT = 120;

router.use(function rateLimit(req, res, next) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  b.count += 1;
  if (b.count > LIMIT) {
    res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
    return res.status(429).json({ status: false, msg: 'Too many requests' });
  }
  next();
});

router.get('/t/:slug',                                       ctrl.landing);
router.get('/t/:slug/sites',                                 ctrl.sites);
router.get('/t/:slug/sites/:siteId/facilities',              ctrl.siteFacilities);
router.get('/t/:slug/facilities/:id',                        ctrl.facility);

module.exports = router;
