// Uploads proxy — forwards a multipart `file` from an authenticated admin
// to the Azure Blob sidecar, then returns the public URL so the frontend
// can write it into facilities.image_url / floors.layout_image_url.
//
// Lives at /api/uploads/image (auth + admin gate applied in the router).
//
// Same shape as floorScan/floorScan.controller.js: in-memory multer →
// fetch+FormData to the sidecar → bubble the response back. We don't
// persist anything on the Node disk.

const multer = require('multer');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');

const SVC_URL = (process.env.AZURE_BLOB_SVC_URL || 'http://127.0.0.1:5002').replace(/\/$/, '');
const INTERNAL_KEY = process.env.AZURE_BLOB_INTERNAL_KEY || '';

// Memory storage — sidecar streams the bytes to Azure, no disk hit on Node.
const upload = multer({
  storage: multer.memoryStorage(),
  // 10 MB ceiling on the proxy. The sidecar also caps independently.
  limits: { fileSize: 10 * 1024 * 1024 },
});

exports.uploadMiddleware = upload.single('file');

exports.uploadImage = asyncHandler(async function (req, res) {
  if (!req.file || !req.file.buffer || req.file.size === 0) {
    return fail(res, 'No file provided in multipart `file` field', 415);
  }

  // Only the obvious image MIMEs — keeps cover-image upload from being
  // turned into a malware drop.
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (!allowed.includes(req.file.mimetype)) {
    return fail(res, 'Unsupported image type: ' + req.file.mimetype, 415);
  }

  const fd = new FormData();
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'upload');
  // `category` becomes the folder prefix inside the container so we can
  // tell facility cover images from floor maps at a glance.
  fd.append('category', String(req.body.category || 'facility-images').replace(/[^a-zA-Z0-9._-]/g, ''));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);

  let upstream;
  try {
    upstream = await fetch(SVC_URL + '/upload', {
      method: 'POST',
      body: fd,
      signal: ctrl.signal,
      headers: INTERNAL_KEY ? { 'X-Internal-Key': INTERNAL_KEY } : {},
    });
  } catch (e) {
    console.error('[uploads] sidecar unreachable:', e && e.message);
    return fail(res,
      'Upload service is not reachable. Start the Azure Blob sidecar: ' +
      'cd azure-blob-svc && node server.js', 503);
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await upstream.json();
  } catch {
    return fail(res, 'Upload service returned an unexpected response.', 502);
  }

  if (!upstream.ok || !body || body.status === false) {
    const msg = (body && body.msg) || ('Upload failed (HTTP ' + upstream.status + ')');
    return fail(res, msg, upstream.status);
  }

  // body.data = { url, blob_name, container, size, content_type }
  console.log('[uploads] tenant=' + (req.user && req.user.tenant_id) +
              ' user=' + (req.user && req.user.id) +
              ' uploaded ' + body.data.blob_name + ' (' + body.data.size + ' bytes)');

  return ok(res, body.data, 'Uploaded');
});
