// Cron-driven side jobs. See cron.controller.js for the philosophy.
//
// Auth: each route gates on the shared CRON_SECRET (no user session).
// Mount path: /api/cron

const express = require('express');
const ctrl = require('./cron.controller');

const router = express.Router();

router.post('/pre-end-notify', ctrl.requireCronKey, ctrl.preEndNotify);

module.exports = router;
