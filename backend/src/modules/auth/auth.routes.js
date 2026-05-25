const router = require('express').Router();
const ctrl = require('./auth.controller');
const { authRequired } = require('../../middleware/auth');

// Public
router.post('/login',           ctrl.login);
router.post('/register',        ctrl.register);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password',  ctrl.resetPassword);

// Protected
router.post('/logout', authRequired, ctrl.logout);
router.get('/me',      authRequired, ctrl.me);

module.exports = router;
