// Routes for the floor-plan auto-detection proxy.
//
// Just one endpoint right now: POST /api/floor-scan. Body is either:
//   - multipart/form-data with a single `image` file, or
//   - application/json with { image_base64: "<data:image/...;base64,...>" }
//
// Admin-only. tenant_admin + super_admin are the only roles that ever land
// on the facility form where this is invoked.

const express = require('express');
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./floorScan.controller');

const router = express.Router();

router.post(
  '/',
  authRequired,
  requireRole('super_admin', 'tenant_admin'),
  ctrl.uploadMiddleware,
  ctrl.scan
);

module.exports = router;
