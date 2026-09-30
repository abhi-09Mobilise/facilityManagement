// Floor-plan auto-detection proxy.
//
// The Node backend doesn't run OpenCV directly. Instead, the admin uploads
// a floor-plan image through this endpoint, we forward it to the Python
// microservice in floor-scan-svc/, and return the detected coordinates.
//
// Endpoint:
//   POST /api/floor-scan
//     - multipart/form-data, field name `image`  (preferred)
//     - or JSON body { image_base64: "data:image/png;base64,..." }
//   -> { image_width, image_height, chairs:[...], tables_round:[...], tables_rect:[...] }
//
// Auth: tenant_admin + super_admin only (admins only ever see facility
// forms; no need to expose this to bookers).
//
// Failure modes intentionally surface as JSON, not throws:
//   - SCAN_SERVICE_DOWN: returns 503 + a hint about starting the Python svc
//   - SCAN_FAILED: returns 502 + the upstream error so the operator can tune
//   - INVALID_IMAGE: returns 415
// Frontend treats any of these as "fall back to manual placement" — never
// blocks the upload.

const multer = require('multer');
const { ok, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');

// Where the Python service lives. Defaults to localhost in dev; override
// via FLOOR_SCAN_SVC_URL in .env for staging / prod.
const SCAN_URL = (process.env.FLOOR_SCAN_SVC_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');

// In-memory upload (we don't persist the image; just forward + drop).
// 10 MB max — same as the Python service ceiling.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Parse "data:image/png;base64,xxx" into { mime, buf }. Returns null if
// the input doesn't look like a data URL we can decode.
function parseDataUrl(s) {
  if (typeof s !== 'string') return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(s.trim());
  if (!m) return null;
  try {
    return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
  } catch (e) {
    return null;
  }
}

// Resolve { mime, buf, filename } from the request — either from multer
// (multipart upload) or from a base64 JSON body (the existing layout
// editor stores images as data URLs, so this path is the common one).
function resolveImage(req) {
  // 1. Multipart -> req.file
  if (req.file && req.file.buffer && req.file.size > 0) {
    return {
      mime: req.file.mimetype || 'image/png',
      buf: req.file.buffer,
      filename: req.file.originalname || 'floor-plan',
    };
  }
  // 2. JSON body with data URL
  const raw = req.body && (req.body.image_base64 || req.body.imageUrl);
  if (raw) {
    const parsed = parseDataUrl(raw);
    if (parsed) return { ...parsed, filename: 'floor-plan' };
  }
  return null;
}

exports.scan = asyncHandler(async function (req, res) {
  const img = resolveImage(req);
  if (!img) {
    return fail(
      res,
      'No image provided. Send multipart `image` or JSON `image_base64` data URL.',
      415,
      { error_code: 'INVALID_IMAGE', retryable: false }
    );
  }

  // Build a FormData payload for the Python service. Node 18+ has both
  // FormData and Blob in the global scope; no extra dep needed.
  let upstream;
  try {
    const fd = new FormData();
    // FormData.append(name, value, filename) — value can be a Blob.
    const blob = new Blob([img.buf], { type: img.mime });
    fd.append('image', blob, img.filename);

    // 90-second hard timeout so a stuck Python process doesn't hang the
    // request indefinitely. Sized for the Gemini retry+fallback ladder,
    // which in the worst case runs three sequential Google API calls
    // (primary → 2s sleep → primary retry → fallback), each of which can
    // take 10-15s under high demand. Local model paths (/scan-yolo,
    // /scan-architect) finish in 1-3s so the extra headroom is free.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      // Provider-agnostic AI endpoint. The Python service dispatches to
      // Gemini / Claude / OpenAI based on its own AI_PROVIDER env var —
      // neither this controller nor the frontend need to know which one
      // ran. Response shape (ScanResponse) is identical across providers.
      // See floor-scan-svc/app.py `scan_ai()` for the endpoint contract.
      upstream = await fetch(`${SCAN_URL}/scan-ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // ECONNREFUSED / DNS / timeout — service almost certainly down.
    console.error('[floor-scan] upstream unreachable:', e && e.message);
    return fail(
      res,
      'Floor scan service is not reachable. Start the Python service: ' +
      'cd floor-scan-svc && uvicorn app:app --port 5001',
      503,
      { error_code: 'SCAN_SERVICE_DOWN', retryable: true }
    );
  }

  let body;
  try {
    body = await upstream.json();
  } catch (e) {
    console.error('[floor-scan] upstream returned non-JSON:', e && e.message);
    return fail(res, 'Floor scan service returned an unexpected response.', 502, {
      error_code: 'SCAN_INTERNAL_ERROR',
      retryable: false,
    });
  }

  if (!upstream.ok) {
    // Python's /scan-gemini returns a STRUCTURED error body (see
    // floor-scan-svc/app.py `_resolve_final_error`). Prefer that when
    // present so the frontend gets a stable `error_code` / `retryable`
    // contract instead of a raw Python exception string.
    //
    // FastAPI wraps our dict in `{ "detail": {...} }`; older endpoints
    // (/scan, /scan-yolo, /scan-architect) still use string details.
    const detailObj =
      body && typeof body.detail === 'object' && body.detail !== null
        ? body.detail
        : null;

    if (detailObj && typeof detailObj.error_code === 'string') {
      // Structured path — pass code + retryable through to the frontend.
      const msg =
        typeof detailObj.message === 'string' && detailObj.message.trim()
          ? detailObj.message
          : 'Floor scan failed.';
      console.warn(
        '[floor-scan] upstream failure',
        upstream.status,
        detailObj.error_code,
        `primary=${detailObj.primary_status ?? '-'}`,
        `fallback=${detailObj.fallback_status ?? '-'}`
      );
      return fail(res, msg, upstream.status, {
        error_code: detailObj.error_code,
        retryable: Boolean(detailObj.retryable),
        primary_status: detailObj.primary_status ?? null,
        fallback_status: detailObj.fallback_status ?? null,
      });
    }

    // Legacy / non-structured path — keep prior behaviour but sanitise:
    // stringify only the outermost fields, not a full JSON dump that
    // might contain a Python traceback.
    const legacyDetail =
      (body && (typeof body.detail === 'string' ? body.detail : body.msg)) ||
      upstream.statusText ||
      'unknown upstream error';
    console.warn('[floor-scan] upstream failure', upstream.status, legacyDetail);
    return fail(res, `Floor scan failed: ${legacyDetail}`, upstream.status, {
      error_code: 'SCAN_UPSTREAM_ERROR',
      retryable: upstream.status >= 500 && upstream.status < 600,
    });
  }

  // Pass-through — the frontend already knows the shape (we documented it
  // in floor-scan-svc/README.md). Logged in summary form so we can spot
  // weird detection counts over time.
  const cs = (body.chairs || []).length;
  const tr = (body.tables_round || []).length;
  const tx = (body.tables_rect || []).length;
  console.log(
    `[floor-scan] tenant=${req.user && req.user.tenant_id} user=${req.user && req.user.id} ` +
    `result: chairs=${cs} tables_round=${tr} tables_rect=${tx} image=${body.image_width}x${body.image_height}`
  );

  return ok(res, body);
});

// Exported so the routes file can apply it before the controller.
exports.uploadMiddleware = upload.single('image');
