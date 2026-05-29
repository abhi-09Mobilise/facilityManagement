"""
Floor-plan furniture detector.

Stands alongside the Node backend as its own HTTP service so we don't have
to compile native bindings in Node. Detection runs entirely in-memory; we
never persist the uploaded image.

Pipeline (architect-drawn plans, mixed style):
  1. Decode image -> grayscale.
  2. Adaptive binary threshold so we tolerate uneven brightness.
  3. Morphological close to heal small gaps in line work.
  4. Find external contours.
  5. Classify each contour by area + shape:
       chair        -> small, roughly square (aspect 0.6-1.4)
       table_round  -> larger, circularity > 0.75
       table_rect   -> larger, bounding-rect fill > 0.85, aspect 1.2-4
  6. Deduplicate near-overlaps with simple IoU check.
  7. Return {image_width, image_height, chairs, tables_round, tables_rect}.

Thresholds are env-tunable:
  CHAIR_MIN_PX_AREA       (default 120)     - reject contours smaller than this
  CHAIR_MAX_PX_AREA       (default 2500)    - upper bound for "chair"
  TABLE_MIN_PX_AREA       (default 2500)    - lower bound for "table"
  TABLE_MAX_PX_AREA       (default 90000)   - reject anything bigger (probably a room)
  CIRCULARITY_THRESHOLD   (default 0.75)    - round tables
  RECT_FILL_THRESHOLD     (default 0.85)    - rect tables (contour area / bbox area)
  DEDUPE_IOU              (default 0.5)     - dedupe near-overlaps

Run locally:
  pip install -r requirements.txt
  uvicorn app:app --host 0.0.0.0 --port 5001 --reload
"""

import io
import os
import logging
from typing import List, Dict, Any

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Template-matching layer. Runs before the contour-based pass and finds
# pixel-level matches for any sample chair/table icons the admin dropped
# into templates/<category>/. See templates_matcher.py for details and
# the README for "how to crop a good template".
from templates_matcher import (
    match_all_templates,
    template_count,
    TEMPLATE_MATCH_THRESHOLD,
    TEMPLATE_SCALES,
)


# ----------------------------------------------------------------------
# Config (env-tunable so we can iterate without redeploying)
# ----------------------------------------------------------------------

def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

CHAIR_MIN_PX_AREA     = _f("CHAIR_MIN_PX_AREA",     60)
CHAIR_MAX_PX_AREA     = _f("CHAIR_MAX_PX_AREA",     500)
TABLE_MIN_PX_AREA     = _f("TABLE_MIN_PX_AREA",     2500)
TABLE_MAX_PX_AREA     = _f("TABLE_MAX_PX_AREA",     90000)
CIRCULARITY_THRESHOLD = _f("CIRCULARITY_THRESHOLD", 0.75)
RECT_FILL_THRESHOLD   = _f("RECT_FILL_THRESHOLD",   0.85)
DEDUPE_IOU            = _f("DEDUPE_IOU",            0.5)

# Max upload size in bytes (10 MB by default) to avoid OOM on large CAD PNGs.
MAX_UPLOAD_BYTES = int(_f("MAX_UPLOAD_BYTES", 10 * 1024 * 1024))

logging.basicConfig(level=logging.INFO, format="[floor-scan] %(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("floor-scan")


# ----------------------------------------------------------------------
# Response shape
# ----------------------------------------------------------------------

class Chair(BaseModel):
    x: int          # top-left x of bounding box, image pixels
    y: int          # top-left y
    w: int
    h: int
    conf: float     # 0..1 confidence proxy (size + squareness)

class TableRound(BaseModel):
    cx: int         # centre x
    cy: int         # centre y
    r: int          # radius in pixels
    conf: float     # circularity 0..1

class TableRect(BaseModel):
    x: int
    y: int
    w: int
    h: int
    conf: float     # rect-fill 0..1

class ScanResponse(BaseModel):
    image_width:  int
    image_height: int
    chairs:       List[Chair]
    tables_round: List[TableRound]
    tables_rect:  List[TableRect]
    thresholds:   Dict[str, float]   # echo back for debugging


# ----------------------------------------------------------------------
# Detection helpers
# ----------------------------------------------------------------------

def _iou_xywh(a, b) -> float:
    """IoU of two bounding boxes given as (x, y, w, h)."""
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    inter_x1 = max(a[0], b[0])
    inter_y1 = max(a[1], b[1])
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    iw = max(0, inter_x2 - inter_x1)
    ih = max(0, inter_y2 - inter_y1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    a_area = a[2] * a[3]
    b_area = b[2] * b[3]
    return inter / float(a_area + b_area - inter)

def _dedupe_boxes(items: List[Dict[str, Any]], iou_thresh: float) -> List[Dict[str, Any]]:
    """Greedy NMS-style dedupe — keep highest-confidence box, drop overlapping."""
    items_sorted = sorted(items, key=lambda d: -d.get("conf", 0))
    kept: List[Dict[str, Any]] = []
    for it in items_sorted:
        box = (it["x"], it["y"], it["w"], it["h"])
        clash = any(_iou_xywh(box, (k["x"], k["y"], k["w"], k["h"])) > iou_thresh for k in kept)
        if not clash:
            kept.append(it)
    return kept

def _detect(img_bgr: np.ndarray):
    """
    Run the full detection pipeline on a BGR image.
    Returns (chairs, tables_round, tables_rect) as lists of dicts ready to
    serialise.
    """
    h_img, w_img = img_bgr.shape[:2]

    # 1. Grayscale
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # 1b. Template-matching pass (runs first so its matches win in dedupe).
    # If templates/ is empty this returns empty lists silently and the
    # contour-based detector below carries the whole load.
    tpl_hits = match_all_templates(gray)
    tpl_chairs       = tpl_hits.get("chairs",       []) or []
    tpl_tables_round = tpl_hits.get("tables_round", []) or []
    tpl_tables_rect  = tpl_hits.get("tables_rect",  []) or []

    # 2. Adaptive threshold so we don't fail on uneven lighting / scanned plans
    bin_img = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=8,
    )

    # 3. Morphological close — heal 1-2 px gaps in line drawings so a chair
    # outlined as 4 short segments still becomes one closed contour.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.morphologyEx(bin_img, cv2.MORPH_CLOSE, kernel, iterations=1)

    # 4. Find external contours
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    chairs:       List[Dict[str, Any]] = []
    tables_round: List[Dict[str, Any]] = []
    tables_rect:  List[Dict[str, Any]] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < CHAIR_MIN_PX_AREA:
            continue        # noise dot, dimension marker, etc.

        x, y, w, h = cv2.boundingRect(cnt)
        if w == 0 or h == 0:
            continue
        bbox_area = w * h
        if bbox_area == 0:
            continue
        rect_fill = area / float(bbox_area)
        aspect = w / float(h)
        perim = cv2.arcLength(cnt, True)
        circularity = (4 * np.pi * area / (perim * perim)) if perim > 0 else 0.0

        # --- Chair ---
        # Small + roughly square. Square-ish chairs are common in floor plans;
        # wide rectangular shapes that are chair-sized are usually dimension labels.
        if (CHAIR_MIN_PX_AREA <= area <= CHAIR_MAX_PX_AREA) and (0.6 <= aspect <= 1.4):
            # Confidence proxy: prefer items closer to chair_mid + perfectly square
            mid = (CHAIR_MIN_PX_AREA + CHAIR_MAX_PX_AREA) / 2.0
            size_score = 1.0 - abs(area - mid) / max(mid - CHAIR_MIN_PX_AREA, 1.0)
            square_score = 1.0 - abs(1.0 - aspect)
            conf = max(0.0, min(1.0, 0.5 * size_score + 0.5 * square_score))
            chairs.append({
                "x": int(x), "y": int(y), "w": int(w), "h": int(h),
                "conf": round(conf, 3),
            })
            continue

        # --- Round table ---
        if (TABLE_MIN_PX_AREA <= area <= TABLE_MAX_PX_AREA) and circularity >= CIRCULARITY_THRESHOLD:
            (cx_f, cy_f), r_f = cv2.minEnclosingCircle(cnt)
            tables_round.append({
                "cx": int(cx_f), "cy": int(cy_f), "r": int(r_f),
                # Also keep a bounding box so dedupe IoU works uniformly.
                "x": int(cx_f - r_f), "y": int(cy_f - r_f),
                "w": int(2 * r_f), "h": int(2 * r_f),
                "conf": round(min(1.0, circularity), 3),
            })
            continue

        # --- Rect table ---
        if (TABLE_MIN_PX_AREA <= area <= TABLE_MAX_PX_AREA) and rect_fill >= RECT_FILL_THRESHOLD:
            # Restrict to plausible table proportions; avoid catching rooms.
            # Long, very narrow rectangles aren't furniture.
            if 1.2 <= max(aspect, 1 / aspect) <= 4.0:
                tables_rect.append({
                    "x": int(x), "y": int(y), "w": int(w), "h": int(h),
                    "conf": round(min(1.0, rect_fill), 3),
                })
                continue

    # 5. Merge template-matched hits into each category, with templates
    # going first so they win in dedupe (sorted by conf, template matches
    # are typically > contour matches once the user supplies good templates).
    # For round tables, we need to add cx/cy/r fields so the existing
    # output schema matches; we derive them from the bbox.
    for t in tpl_tables_round:
        cx = t["x"] + t["w"] // 2
        cy = t["y"] + t["h"] // 2
        r  = min(t["w"], t["h"]) // 2
        tables_round.append({**t, "cx": cx, "cy": cy, "r": r})
    chairs       = tpl_chairs + chairs
    tables_rect  = tpl_tables_rect + tables_rect

    # 6. Dedupe each category independently
    chairs       = _dedupe_boxes(chairs,       DEDUPE_IOU)
    tables_round = [t for t in _dedupe_boxes(tables_round, DEDUPE_IOU)]
    tables_rect  = _dedupe_boxes(tables_rect,  DEDUPE_IOU)

    # Strip the bbox helper fields we tacked onto round tables for dedupe.
    tables_round_clean = [
        {"cx": t["cx"], "cy": t["cy"], "r": t["r"], "conf": t["conf"]}
        for t in tables_round
    ]

    return chairs, tables_round_clean, tables_rect, w_img, h_img


# ----------------------------------------------------------------------
# FastAPI app
# ----------------------------------------------------------------------

app = FastAPI(title="Facility floor-plan scanner", version="1.0.0")

# CORS open — service sits behind the Node backend, not exposed to the
# internet. If you ever expose this directly to the browser, lock this down.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "floor-scan",
        "templates": {
            # Live count -- forces a cache refresh so newly dropped templates
            # show up here without restarting the service.
            "loaded": template_count(),
            "match_threshold": TEMPLATE_MATCH_THRESHOLD,
            "scales": TEMPLATE_SCALES,
        },
        "thresholds": {
            "chair_min": CHAIR_MIN_PX_AREA, "chair_max": CHAIR_MAX_PX_AREA,
            "table_min": TABLE_MIN_PX_AREA, "table_max": TABLE_MAX_PX_AREA,
            "circularity": CIRCULARITY_THRESHOLD,
            "rect_fill": RECT_FILL_THRESHOLD,
            "dedupe_iou": DEDUPE_IOU,
        },
    }


@app.post("/scan", response_model=ScanResponse)
async def scan(image: UploadFile = File(...)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image")

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_UPLOAD_BYTES} bytes)")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    chairs, tables_round, tables_rect, w_img, h_img = _detect(img_bgr)

    log.info(
        "scan: %dx%d  chairs=%d  tables_round=%d  tables_rect=%d",
        w_img, h_img, len(chairs), len(tables_round), len(tables_rect),
    )

    return ScanResponse(
        image_width=w_img,
        image_height=h_img,
        chairs=chairs,
        tables_round=tables_round,
        tables_rect=tables_rect,
        thresholds={
            "chair_min": CHAIR_MIN_PX_AREA, "chair_max": CHAIR_MAX_PX_AREA,
            "table_min": TABLE_MIN_PX_AREA, "table_max": TABLE_MAX_PX_AREA,
            "circularity": CIRCULARITY_THRESHOLD,
            "rect_fill": RECT_FILL_THRESHOLD,
            "dedupe_iou": DEDUPE_IOU,
        },
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5001))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
