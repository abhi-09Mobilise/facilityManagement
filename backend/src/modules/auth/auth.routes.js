const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('./auth.controller');
const { authRequired } = require('../../middleware/auth');

// BUG-25 fix: rate-limit the login endpoint so an attacker can't brute-force
// credentials. The controller already tracks per-user `login_attempts`, but
// that only slows a single-account attack — a credential-stuffer trying 1000
// usernames each with one guess would slip through. This IP-based bucket
// adds the second line of defence.
//
//   • 10 attempts / 15 min / IP for the login route (POST /auth/login)
//   • Successful (2xx) requests don't count towards the budget
//   • Returns 429 with Retry-After once the limit is hit
//   • Standard rate-limit headers (RateLimit-*) exposed so API clients can
//     back off programmatically
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { status: false, msg: 'Too many login attempts. Please try again in a few minutes.' },
});

// A looser bucket for the two password-recovery flows — they also hit the
// users table and shouldn't be enumerable at machine speed.
const passwordRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { status: false, msg: 'Too many requests. Please try again later.' },
});

// Public
router.post('/login',           loginLimiter,            ctrl.login);
router.post('/register',        ctrl.register);
router.post('/forgot-password', passwordRecoveryLimiter, ctrl.forgotPassword);
router.post('/reset-password',  passwordRecoveryLimiter, ctrl.resetPassword);

// Protected
router.post('/logout', authRequired, ctrl.logout);
router.get('/me',      authRequired, ctrl.me);

module.exports = router;
