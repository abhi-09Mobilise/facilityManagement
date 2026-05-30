// Azure Blob Storage sidecar.
//
// Same architectural shape as floor-scan-svc/: a tiny HTTP service that
// the main Node API talks to over loopback. The browser never hits it
// directly. Auth is a shared secret (INTERNAL_KEY) in the X-Internal-Key
// header so only the main API can call it even if the port leaks.
//
// Endpoints:
//   GET    /health                              — service + storage sanity
//   POST   /upload                              — multipart upload  →  { url, blob_name, ... }
//   DELETE /file?container=...&name=...         — delete one blob
//
// Storage is partitioned by date (YYYY/MM/DD) + a random suffix so two
// admins uploading 'floor-plan.png' at the same time can't collide.
//
// Why a sidecar instead of inlining @azure/storage-blob in the main API?
//  - Same isolation pattern as the OpenCV service (familiar to ops).
//  - Connection string + storage account key live in only ONE process.
//  - Lets us point at a different storage account per env without
//    redeploying the main API.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const crypto = require('crypto');
const { BlobServiceClient } = require('@azure/storage-blob');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '5002', 10);
const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const DEFAULT_CONTAINER = process.env.AZURE_BLOB_CONTAINER || 'fm-uploads';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const INTERNAL_KEY = process.env.INTERNAL_KEY || '';
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '10', 10);

if (!CONN) {
  console.error('[azure-blob] FATAL: AZURE_STORAGE_CONNECTION_STRING is not set');
  process.exit(1);
}

// One BlobServiceClient is enough — internally pools connections + keeps
// the OAuth/shared-key auth state hot. Reusing it avoids handshake cost
// on every upload.
const blobService = BlobServiceClient.fromConnectionString(CONN);

// Light helper — ensure the container exists with public-read access so
// the URLs returned can be used directly by the browser without SAS
// tokens. If your security model forbids public-read containers, set
// CONTAINER_ACCESS=private below and switch the upload response to mint
// a short-lived SAS URL instead (left as a TODO so the operator chooses).
const CONTAINER_ACCESS = process.env.CONTAINER_ACCESS || 'blob'; // 'blob' | 'container' | 'private'
async function getContainer(name) {
  const c = blobService.getContainerClient(name);
  if (CONTAINER_ACCESS !== 'private') {
    await c.createIfNotExists({ access: CONTAINER_ACCESS });
  } else {
    await c.createIfNotExists();
  }
  return c;
}

const app = express();
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Internal-key gate — every endpoint except /health needs the header.
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!INTERNAL_KEY) return next(); // un-gated when no secret configured (dev)
  if (req.get('X-Internal-Key') === INTERNAL_KEY) return next();
  return res.status(401).json({ status: false, msg: 'Bad or missing X-Internal-Key' });
});

// Multer in-memory — we never persist the upload locally, just stream it
// into Azure and let the buffer GC.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// ----------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------

app.get('/health', async (_req, res) => {
  try {
    // Touch the service properties — fastest "is the storage account
    // reachable + creds valid" check available.
    await blobService.getProperties();
    return res.json({
      ok: true,
      service: 'azure-blob',
      default_container: DEFAULT_CONTAINER,
      max_upload_mb: MAX_UPLOAD_MB,
      public_base_url: PUBLIC_BASE_URL || null,
    });
  } catch (e) {
    return res.status(503).json({ ok: false, msg: e && e.message });
  }
});

// POST /upload
//   multipart field `file`             — required, the actual bytes
//   form field    `category` (optional) — folder prefix inside the container
//                                         e.g. 'facility-images', 'floor-maps'
//   form field    `container` (optional) — override the default container
//
// Returns: { status, data: { url, blob_name, container, size, content_type } }
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.size === 0) {
      return res.status(415).json({ status: false, msg: 'No file in multipart `file` field' });
    }

    const containerName = String(req.body.container || DEFAULT_CONTAINER).trim();
    const category = String(req.body.category || 'misc').replace(/[^a-zA-Z0-9._-]/g, '');
    const now = new Date();
    const datePath =
      now.getUTCFullYear() + '/' +
      String(now.getUTCMonth() + 1).padStart(2, '0') + '/' +
      String(now.getUTCDate()).padStart(2, '0');
    // Random suffix so two simultaneous uploads of 'floor.png' don't collide.
    const safeName = String(req.file.originalname || 'upload.bin')
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .slice(-80);
    const rand = crypto.randomBytes(6).toString('hex');
    const blobName = category + '/' + datePath + '/' + Date.now() + '_' + rand + '_' + safeName;

    const container = await getContainer(containerName);
    const block = container.getBlockBlobClient(blobName);
    await block.uploadData(req.file.buffer, {
      blobHTTPHeaders: {
        blobContentType: req.file.mimetype || 'application/octet-stream',
        // 1y immutable cache — blob name is unique, so cache-bust isn't an issue.
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // The browser-facing URL.
    //
    //   PUBLIC_BASE_URL set         → use it (CDN / custom domain in front of the account).
    //   not set                     → return the raw blob URL from the SDK.
    const sdkUrl = block.url;
    let url = sdkUrl;
    if (PUBLIC_BASE_URL) {
      url = PUBLIC_BASE_URL + '/' + containerName + '/' + blobName;
    }

    return res.status(201).json({
      status: true,
      data: {
        url,
        blob_name: blobName,
        container: containerName,
        size: req.file.size,
        content_type: req.file.mimetype,
      },
    });
  } catch (e) {
    console.error('[azure-blob] upload failed:', e && (e.stack || e.message || e));
    return res.status(500).json({ status: false, msg: 'Upload failed: ' + (e && e.message) });
  }
});

// DELETE /file?container=...&name=...
app.delete('/file', async (req, res) => {
  try {
    const containerName = String(req.query.container || DEFAULT_CONTAINER).trim();
    const blobName = String(req.query.name || '').trim();
    if (!blobName) return res.status(400).json({ status: false, msg: 'name= is required' });
    const c = blobService.getContainerClient(containerName);
    const r = await c.deleteBlob(blobName, { deleteSnapshots: 'include' });
    return res.json({ status: true, data: { request_id: r.requestId } });
  } catch (e) {
    // 404 from Azure → blob already gone. Treat as success — idempotent delete.
    if (e && e.statusCode === 404) {
      return res.json({ status: true, data: { note: 'already_absent' } });
    }
    console.error('[azure-blob] delete failed:', e && (e.stack || e.message || e));
    return res.status(500).json({ status: false, msg: 'Delete failed: ' + (e && e.message) });
  }
});

// Multer error → 413 / 415 instead of 500.
app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ status: false, msg: 'File too large (max ' + MAX_UPLOAD_MB + 'MB)' });
  }
  console.error('[azure-blob] unhandled:', err && (err.stack || err.message || err));
  return res.status(500).json({ status: false, msg: 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log('[azure-blob] listening on http://' + HOST + ':' + PORT +
    ' (container=' + DEFAULT_CONTAINER + ', max=' + MAX_UPLOAD_MB + 'MB)');
});
