"""
Template-matching layer for the floor-plan scanner.

WHY THIS EXISTS:
The contour-based detector in app.py finds "small roughly-square outlines"
and calls them chairs. That works without training data but trips on every
small square thing in your plan (legend symbols, dimension boxes, columns).

This layer adds a second, more precise pass: for each PNG you drop into
templates/<category>/, cv2.matchTemplate slides the icon across the plan
and reports every pixel-level match above a confidence threshold. This is
exactly what the user asked for when they said "can I feed it images of
chairs?".

PIPELINE:
  1. Load all templates from templates/{chairs,tables_round,tables_rect}/.
     Cached in memory; reloaded automatically when any file's mtime changes
     so admins can hot-swap templates without restarting.
  2. For each template, for each scale in TEMPLATE_SCALES, run
     cv2.matchTemplate(image, template, TM_CCOEFF_NORMED) and threshold
     the result map.
  3. Each above-threshold pixel becomes a candidate {x, y, w, h, conf}.
  4. Caller dedupes via NMS (we share the IoU helper in app.py).

WHY MULTI-SCALE:
A template cropped at ~30 px wide will only match chairs of that exact
size. Real plans get uploaded at different zooms / DPIs. We try 5 scales
by default (0.7, 0.85, 1.0, 1.15, 1.3x) so a single template stretches
to roughly half-to-twice its original size with minor accuracy loss.

WHY GRAYSCALE:
Templates and the plan are both converted to grayscale before matching.
This makes ink colour irrelevant and tolerates slight brightness shifts.
Binary matching looked good on toy inputs but fell apart on real scanned
plans where line weights vary.
"""

import os
import threading
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple

import cv2
import numpy as np


# ---- Config -----------------------------------------------------------

# Where to look for templates. Subfolders match output categories.
TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
CATEGORIES = ("chairs", "tables_round", "tables_rect")

# Acceptable image extensions. We treat ".gitkeep" / hidden files as not-images.
VALID_EXTS = (".png", ".jpg", ".jpeg", ".bmp")

# Threshold for cv2.matchTemplate's normalised cross-correlation result.
# 1.0 = perfect match. 0.7 is a sensible floor for line-drawn icons; raise
# if you see too many false positives, lower if real chairs get missed.
def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

TEMPLATE_MATCH_THRESHOLD = _f("TEMPLATE_MATCH_THRESHOLD", 0.63)

# Scales to try per template. Comma-separated env var; default covers most
# real-world zoom variation without being slow.
_scale_str = os.environ.get("TEMPLATE_SCALES", "0.70,0.85,1.00,1.15,1.30")
try:
    TEMPLATE_SCALES: List[float] = [float(s) for s in _scale_str.split(",") if s.strip()]
except ValueError:
    TEMPLATE_SCALES = [0.7, 0.85, 1.0, 1.15, 1.3]

# After per-template thresholding, the matchTemplate result map often has
# clusters of nearly-identical matches around one true chair. We pre-dedupe
# per template at this IoU before returning to the caller (which then does
# a final cross-category dedupe).
LOCAL_DEDUPE_IOU = _f("LOCAL_DEDUPE_IOU", 0.4)


# ---- Cache ------------------------------------------------------------

@dataclass
class _Tpl:
    name: str          # filename (without extension) for logging
    category: str
    gray: np.ndarray   # grayscale image, ready to match


# Loaded templates keyed by (category, filename). Reloaded on mtime change
# so admins can drop in new templates without restarting the service.
_cache: Dict[Tuple[str, str], _Tpl] = {}
_cache_mtimes: Dict[Tuple[str, str], float] = {}
_cache_lock = threading.Lock()


def _scan_dir_with_mtimes() -> Dict[Tuple[str, str], float]:
    """Walk templates/ and return {(category, filename): mtime}."""
    found: Dict[Tuple[str, str], float] = {}
    if not os.path.isdir(TEMPLATES_DIR):
        return found
    for cat in CATEGORIES:
        cat_dir = os.path.join(TEMPLATES_DIR, cat)
        if not os.path.isdir(cat_dir):
            continue
        for fname in os.listdir(cat_dir):
            if fname.startswith("."):
                continue
            if not fname.lower().endswith(VALID_EXTS):
                continue
            full = os.path.join(cat_dir, fname)
            try:
                mt = os.path.getmtime(full)
            except OSError:
                continue
            found[(cat, fname)] = mt
    return found


def _load_one(cat: str, fname: str) -> _Tpl | None:
    """Read a single template file off disk as a grayscale numpy array."""
    full = os.path.join(TEMPLATES_DIR, cat, fname)
    # cv2.imread returns None for unreadable / corrupt files.
    img = cv2.imread(full, cv2.IMREAD_GRAYSCALE)
    if img is None or img.size == 0:
        return None
    return _Tpl(name=os.path.splitext(fname)[0], category=cat, gray=img)


def _refresh_cache_if_needed() -> None:
    """Rescan templates/ and refresh _cache when any mtime changed or files
    were added / removed. Cheap enough to call on every request."""
    with _cache_lock:
        current = _scan_dir_with_mtimes()
        if current == _cache_mtimes:
            return  # no change since last refresh

        # Drop anything that disappeared or changed mtime.
        for key in list(_cache.keys()):
            if key not in current or current[key] != _cache_mtimes.get(key):
                _cache.pop(key, None)
                _cache_mtimes.pop(key, None)

        # Add new / re-add changed.
        for key, mt in current.items():
            if key in _cache:
                continue
            tpl = _load_one(*key)
            if tpl is not None:
                _cache[key] = tpl
                _cache_mtimes[key] = mt


def get_templates_by_category() -> Dict[str, List[_Tpl]]:
    """Return loaded templates grouped by output category. Refreshes cache."""
    _refresh_cache_if_needed()
    out: Dict[str, List[_Tpl]] = {c: [] for c in CATEGORIES}
    with _cache_lock:
        for tpl in _cache.values():
            if tpl.category in out:
                out[tpl.category].append(tpl)
    return out


def template_count() -> int:
    _refresh_cache_if_needed()
    with _cache_lock:
        return len(_cache)


# ---- IoU helper (kept local so app.py can share its own version) ------

def _iou(a, b) -> float:
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    iw = max(0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    if inter == 0:
        return 0.0
    return inter / float(a[2] * a[3] + b[2] * b[3] - inter)


def _local_dedupe(items: List[Dict[str, Any]], iou_thresh: float) -> List[Dict[str, Any]]:
    items = sorted(items, key=lambda d: -d["conf"])
    kept: List[Dict[str, Any]] = []
    for it in items:
        box = (it["x"], it["y"], it["w"], it["h"])
        if any(_iou(box, (k["x"], k["y"], k["w"], k["h"])) > iou_thresh for k in kept):
            continue
        kept.append(it)
    return kept


# ---- The actual matcher -----------------------------------------------

def match_one_template(image_gray: np.ndarray, tpl: _Tpl,
                       threshold: float, scales: List[float]) -> List[Dict[str, Any]]:
    """
    Slide tpl across image_gray at every requested scale; return every
    above-threshold match as {x, y, w, h, conf}.
    """
    out: List[Dict[str, Any]] = []
    img_h, img_w = image_gray.shape[:2]

    for s in scales:
        tw = max(1, int(round(tpl.gray.shape[1] * s)))
        th = max(1, int(round(tpl.gray.shape[0] * s)))
        # Skip scales that would make the template larger than the image
        # itself — cv2.matchTemplate errors on that.
        if tw > img_w or th > img_h:
            continue

        # Resize template (INTER_AREA for shrink, INTER_CUBIC for grow).
        if s < 1.0:
            scaled = cv2.resize(tpl.gray, (tw, th), interpolation=cv2.INTER_AREA)
        elif s > 1.0:
            scaled = cv2.resize(tpl.gray, (tw, th), interpolation=cv2.INTER_CUBIC)
        else:
            scaled = tpl.gray

        # TM_CCOEFF_NORMED returns -1..1; 1.0 is perfect. It's the most
        # forgiving common choice for line-drawn templates.
        result = cv2.matchTemplate(image_gray, scaled, cv2.TM_CCOEFF_NORMED)

        # Every pixel >= threshold is a candidate top-left for a match of
        # size (tw, th). np.where returns (row_idxs, col_idxs).
        ys, xs = np.where(result >= threshold)
        for x, y in zip(xs.tolist(), ys.tolist()):
            out.append({
                "x": int(x), "y": int(y),
                "w": int(tw), "h": int(th),
                "conf": float(result[y, x]),
            })
    return out


def match_all_templates(image_gray: np.ndarray) -> Dict[str, List[Dict[str, Any]]]:
    """
    Run every loaded template against image_gray. Returns matches grouped
    by category, each list locally-deduped to remove the cluster of near-
    duplicate matches that matchTemplate produces around each true hit.
    """
    by_cat = get_templates_by_category()
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    if all(len(v) == 0 for v in by_cat.values()):
        return out  # no templates loaded — silent skip, caller falls back

    for cat, tpls in by_cat.items():
        cat_hits: List[Dict[str, Any]] = []
        for tpl in tpls:
            cat_hits.extend(
                match_one_template(image_gray, tpl, TEMPLATE_MATCH_THRESHOLD, TEMPLATE_SCALES)
            )
        out[cat] = _local_dedupe(cat_hits, LOCAL_DEDUPE_IOU)
    return out
