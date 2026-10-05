// Routes for the floor-plan auto-detection proxy.
//
// Just one endpoint right now: POST /api/floor-scan. Body is either:
//   - multipart/form-data with a single `image` file, or
//   - application/json with { image_base64: "<data:image/...;base64,...>" }
//
// Admin-only. super_admin, tenant_admin and org_admin all reach the facility
// form (org_admin manages facilities within their own org), so all three can
// invoke the detection proxy. Mirrors facilities.routes.js create/update.

const express = require('express');
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./floorScan.controller');

const router = express.Router();

router.post(
  '/',
  authRequired,
  requireRole('super_admin', 'tenant_admin', 'org_admin'),
  ctrl.uploadMiddleware,
  ctrl.scan
);

module.exports = router;
