# Floor-plan scanner (Python microservice)

Small FastAPI service that scans an uploaded architectural floor plan and
returns the coordinates of detected chairs and tables. The Node backend
calls this service from its `POST /api/floor-scan` endpoint — it isn't
exposed directly to the browser.

## Run locally

```bash
cd floor-scan-svc
python -m venv .venv
.\.venv\Scripts\activate          # Windows
# source .venv/bin/activate       # macOS/Linux

pip install -r requirements.txt

# Dev (auto-reload):
uvicorn app:app --host 127.0.0.1 --port 5001 --reload

# Or one-shot:
python app.py
```

Hit `http://127.0.0.1:5001/health` to confirm it's up.

## Endpoints

### `GET /health`
Liveness probe. Echoes current thresholds.

### `POST /scan`
Multipart upload — field name **`image`** — returns JSON:

```json
{
  "image_width": 1200,
  "image_height": 800,
  "chairs":       [{"x": 120, "y": 240, "w": 30, "h": 30, "conf": 0.82}],
  "tables_round": [{"cx": 300, "cy": 450, "r": 80, "conf": 0.91}],
  "tables_rect":  [{"x": 200, "y": 300, "w": 200, "h": 100, "conf": 0.78}],
  "thresholds":   { "...": "..." }
}
```

Coordinates are in **original image pixels**. The Node backend forwards
this verbatim to the frontend, which then scales to canvas pixels using
`(widthM * pxPerMeter) / image_width`.

## Tuning

All thresholds are env vars (set them before starting the service):

| Var                    | Default | Meaning                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `CHAIR_MIN_PX_AREA`    | 120     | Reject contours smaller than this — likely noise     |
| `CHAIR_MAX_PX_AREA`    | 2500    | Upper bound for a contour to be classified as chair  |
| `TABLE_MIN_PX_AREA`    | 2500    | Lower bound for a contour to be classified as table  |
| `TABLE_MAX_PX_AREA`    | 90000   | Reject anything larger — probably a room outline     |
| `CIRCULARITY_THRESHOLD`| 0.75    | Round table requires `4πA/P²` above this             |
| `RECT_FILL_THRESHOLD`  | 0.85    | Rect table requires `area / bbox_area` above this    |
| `DEDUPE_IOU`           | 0.5     | Drop overlapping detections above this IoU           |
| `MAX_UPLOAD_BYTES`     | 10485760| Reject images larger than 10 MB                      |

If your plans tend to use larger or smaller furniture symbols, scale the
chair/table area thresholds. A useful first calibration: open one of your
plans in any image editor, measure a typical chair icon in pixels, and
set `CHAIR_MIN_PX_AREA` to about 50% of `chair_w × chair_h` and
`CHAIR_MAX_PX_AREA` to about 150%.

## How accurate is it?

On architect-drawn plans without a fixed symbol library, contour-based
detection lands roughly:

- Chairs: 40–70%, with 10–20% false positives (legend symbols, dimension
  markers).
- Round tables: 60–80% (circles are easy to spot).
- Rect tables: 30–60% (lots of rectangular things in floor plans).

This is a **head-start tool**. The admin reviews the results on the canvas
and adjusts before saving the layout.

## Future improvements

- Template matching when a vendor's symbol library is standardised
- Hough circle detection as a second pass for chairs drawn as circles
- Train a YOLO model on labelled plans for the high-accuracy path

## Deploy

For now, run alongside the Node backend on the same host. Long-term, this
should live in its own container — its only contract is `POST /scan` and
`GET /health`.

---

## Template matching (precision layer)

The contour detector finds "small roughly-square outlines" and calls them
chairs. That works without any training data but trips on legend symbols,
dimension markers and other small squares.

You can **upgrade detection by dropping reference icons into `templates/`**.
The service will try to match each template against the plan first, then
fall back to contour detection for anything templates miss. Templates win
on overlapping detections.

### Folder layout

```
templates/
├── chairs/
│   ├── chair-square-32px.png
│   ├── chair-square-48px.png
│   ├── chair-round-40px.png
│   └── armchair-60px.png
├── tables_round/
│   ├── round-table-100px.png
│   └── round-table-160px.png
└── tables_rect/
    ├── rect-table-120x80.png
    └── rect-table-200x100.png
```

Drop a new PNG, scan again — no restart needed. The service watches mtimes
and refreshes the cache on every request. Hit `GET /health` to confirm
how many templates are currently loaded.

### How to crop a good template (5-minute guide)

1. **Open one of your real floor plans** in any image editor (Photoshop,
   GIMP, Paint.NET, even Windows Snipping Tool).
2. **Find a clean, well-drawn instance of the furniture** you want to
   detect. A chair near the centre of the plan is usually crisper than
   ones at the edge.
3. **Crop tightly around the outline.** Leave at most 1-2 pixels of
   whitespace on each side. A loose crop bakes background into the
   template and hurts matching.
4. **Save as PNG.** JPEG compression artefacts hurt cv2.matchTemplate.
5. **Name it descriptively** — `chair-square-32px.png` so future-you
   remembers what scale and style it represents.
6. **Repeat for each visually distinct style** in your plans. If you've
   got 3 chair styles, give the service 3 templates. The multi-scale
   pass handles size variation automatically (0.7x to 1.3x by default).

### What "a visually distinct style" means

- A square chair icon vs a round chair icon → 2 templates.
- An office chair drawn with armrests vs without → 2 templates.
- The same chair drawn at 30 px wide on one plan and 50 px on another →
  **ONE template is enough** — multi-scale handles it.
- The same chair rotated 45° → see "Limits" below; templates are
  rotation-sensitive. Either supply both orientations or use the
  contour fallback.

### Tuning template matching

| Env var                    | Default          | Meaning                                                  |
| -------------------------- | ---------------- | -------------------------------------------------------- |
| `TEMPLATE_MATCH_THRESHOLD` | `0.70`           | Normalised correlation 0..1 needed to call it a match.   |
| `TEMPLATE_SCALES`          | `0.70,0.85,1.00,1.15,1.30` | Comma-separated scales tried per template.    |
| `LOCAL_DEDUPE_IOU`         | `0.40`           | Per-template cluster dedupe IoU (before final merge).    |

Tune the threshold *down* (e.g. 0.6) if real chairs are being missed.
Tune it *up* (e.g. 0.8) if false positives are creeping in. Each plan
style behaves slightly differently; the env vars let you iterate
without code changes.

### Limits

- **Rotation:** `cv2.matchTemplate` is not rotation-invariant. A chair
  rotated 45° from your template won't match. Workarounds: (a) crop one
  template per orientation, or (b) skip to feature matching (ORB) which
  is rotation-tolerant. Today the service uses templates only.
- **Heavy style variation:** If every plan uses a totally different
  chair drawing, template matching won't bridge that gap. You'd need
  to either standardise on one CAD library or train a YOLO model.
- **Speed:** Each additional template adds ~50-200 ms per scan,
  depending on plan size. 10 templates × 5 scales is still well under
  3 seconds on any modern CPU.

### Verifying a new template works

```powershell
# 1. Confirm the service loaded it
curl http://127.0.0.1:5001/health
# -> "templates": { "loaded": 1, ... }

# 2. Upload a known-good plan and watch the log
# [floor-scan] scan: 1200x800  chairs=18  tables_round=2  tables_rect=1
#
# If chair count went up vs the contour-only baseline, your template is
# matching. If it stayed the same, lower TEMPLATE_MATCH_THRESHOLD and retry.
```
