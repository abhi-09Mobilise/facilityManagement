// /api/uploads/*  — admin-only image uploads (facility cover + floor maps).
//
// File bytes never touch Node's disk: multer holds the buffer in memory,
// uploads.controller streams it to the Azure Blob sidecar, and the URL
// the sidecar returns is sent back to the frontend which stores it in
// facilities.image_url / floors.layout_image_url.

const router = require('express').Router();
const { authRequired, requireRole } = require('../../middleware/auth');
const ctrl = require('./uploads.controller');

// Only tenant_admin + super_admin can upload. Bookers don't have an
// upload affordance anywhere in the UI.
router.post('/image',
  authRequired,
  requireRole('tenant_admin', 'super_admin'),
  ctrl.uploadMiddleware,
  ctrl.uploadImage,
);

module.exports = router;
