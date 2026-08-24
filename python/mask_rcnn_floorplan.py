"""
Mask R-CNN floor-plan worker.

Backed by a matterport-style .h5 checkpoint (via the akTwelve TF2 fork).
Same NDJSON stdin/stdout protocol as the torchvision worker so the Node
wrapper doesn't care which model is behind it.

What it emits per detection (in addition to label / score / box):

  centroid      [cx, cy]  in image px, from the mask
  polygon       [[x,y], ...]  coarse mask contour (~64 points)
  length_px     for walls: length of the mask's principal axis in px
                (walls only — everything else gets a `size_px = [w, h]`)
  angle_deg     for walls: orientation in degrees (0 = horizontal)
  length_m      real metres, only when SCALE_PX_PER_M env var is set

Env vars:
  MASK_RCNN_H5              absolute path to the .h5 file          (required)
  MASK_RCNN_CLASSES         comma-separated class names, index 0=BG (required)
                             e.g. "BG,wall,door,window,bed,stairs"
  SCALE_PX_PER_M            optional; pixels per metre of the plan
                             (e.g. "50" if 50 px = 1 metre)
"""

import os
import sys
import json
import traceback
import numpy as np
from PIL import Image

# ---- output helpers (stderr for logs, stdout for JSON only) ---------------
def log(m): sys.stderr.write("[mask-rcnn-fp] " + m + "\n"); sys.stderr.flush()
def send(o): sys.stdout.write(json.dumps(o) + "\n");         sys.stdout.flush()

H5_PATH        = os.environ.get("MASK_RCNN_H5", "").strip()
CLASS_NAMES    = [c for c in os.environ.get(
    "MASK_RCNN_CLASSES",
    "BG,wall,door,window,bed,stairs"
).split(",") if c]
SCALE_PX_PER_M = float(os.environ.get("SCALE_PX_PER_M", "0") or 0)

if not H5_PATH or not os.path.isfile(H5_PATH):
    send({"ready": False, "error": "MASK_RCNN_H5 not set or file missing: " + H5_PATH})
    sys.exit(1)

# ---- imports (all inside try so the parent hears about missing deps) -----
try:
    from mrcnn.config import Config
    from mrcnn import model as modellib
except Exception as e:
    send({"ready": False, "error": "import mrcnn failed: " + str(e) +
          ".  Install with:  pip install git+https://github.com/akTwelve/Mask_RCNN.git"})
    sys.exit(1)

class InferenceConfig(Config):
    NAME               = "floorplan_inference"
    NUM_CLASSES        = len(CLASS_NAMES)         # includes BG
    GPU_COUNT          = 1
    IMAGES_PER_GPU     = 1
    DETECTION_MIN_CONFIDENCE = 0.4

cfg = InferenceConfig()
log("loading H5: " + H5_PATH)
log("classes: " + ", ".join(CLASS_NAMES))
model = modellib.MaskRCNN(mode="inference", model_dir="logs", config=cfg)
model.load_weights(H5_PATH, by_name=True)
log("ready.")
send({"ready": True, "classes": len(CLASS_NAMES), "scale_px_per_m": SCALE_PX_PER_M})


# ---- geometry helpers -----------------------------------------------------

def mask_polygon(mask, max_points=64):
    """Coarse boundary walk on a HxW binary mask. Same idea as the torch worker."""
    m = mask.astype(np.uint8)
    if m.sum() == 0:
        return None
    padded = np.pad(m, 1, constant_values=0)
    up    = padded[:-2, 1:-1]
    down  = padded[2:,  1:-1]
    left  = padded[1:-1, :-2]
    right = padded[1:-1, 2:]
    boundary = (m == 1) & ((up == 0) | (down == 0) | (left == 0) | (right == 0))
    ys, xs = np.where(boundary)
    if len(xs) == 0:
        return None
    step = max(1, len(xs) // max_points)
    return [[int(x), int(y)] for x, y in zip(xs[::step], ys[::step])]


def mask_centroid(mask):
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    return [float(xs.mean()), float(ys.mean())]


def wall_axis_length_and_angle(mask):
    """
    For elongated shapes (walls) we don't want the bounding-box diagonal —
    we want the length of the wall itself. Do a PCA on the mask pixel
    coordinates: eigenvector with the larger eigenvalue is the wall axis.
    Return (length_px, angle_deg).
    """
    ys, xs = np.where(mask > 0)
    if len(xs) < 5:
        return None, None
    pts = np.stack([xs, ys], axis=1).astype(np.float64)
    pts -= pts.mean(axis=0)
    # covariance eigen-decomposition
    cov = np.cov(pts, rowvar=False)
    vals, vecs = np.linalg.eigh(cov)
    major = vecs[:, np.argmax(vals)]
    # Project every point onto the major axis; span == length in pixels.
    proj = pts @ major
    length_px = float(proj.max() - proj.min())
    angle_deg = float(np.degrees(np.arctan2(major[1], major[0])))
    # Normalise angle to [-90, 90) — walls are undirected.
    if angle_deg >= 90:  angle_deg -= 180
    if angle_deg < -90:  angle_deg += 180
    return length_px, angle_deg


# ---- main detect ----------------------------------------------------------

def detect(image_path, score_threshold=0.4):
    img = np.array(Image.open(image_path).convert("RGB"))
    r = model.detect([img], verbose=0)[0]

    boxes  = r.get("rois",       [])
    labels = r.get("class_ids",  [])
    scores = r.get("scores",     [])
    masks  = r.get("masks",      None)     # H x W x N

    out = []
    n = len(boxes)
    for i in range(n):
        s = float(scores[i])
        if s < score_threshold: continue
        y1, x1, y2, x2 = [float(v) for v in boxes[i]]
        idx   = int(labels[i])
        label = CLASS_NAMES[idx] if 0 <= idx < len(CLASS_NAMES) else str(idx)

        item = {
            "label":       label,
            "label_index": idx,
            "score":       round(s, 4),
            "box":         [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
            "size_px":     [round(x2 - x1, 2), round(y2 - y1, 2)],
        }

        if masks is not None:
            m = masks[:, :, i]
            c = mask_centroid(m)
            if c is not None:
                item["centroid"] = [round(c[0], 2), round(c[1], 2)]
            poly = mask_polygon(m)
            if poly is not None:
                item["polygon"] = poly

            # Walls-only: PCA-based length + orientation.
            if label.lower() == "wall":
                length_px, angle_deg = wall_axis_length_and_angle(m)
                if length_px is not None:
                    item["length_px"] = round(length_px, 2)
                    item["angle_deg"] = round(angle_deg, 2)
                    if SCALE_PX_PER_M > 0:
                        item["length_m"] = round(length_px / SCALE_PX_PER_M, 3)

        # Everything else gets pixel width/height already, plus a metre size
        # when a scale is set.
        if SCALE_PX_PER_M > 0:
            item["size_m"] = [
                round((x2 - x1) / SCALE_PX_PER_M, 3),
                round((y2 - y1) / SCALE_PX_PER_M, 3),
            ]

        out.append(item)
    return out


# ---- main loop ------------------------------------------------------------
for raw in sys.stdin:
    line = raw.strip()
    if not line: continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        results = detect(req["path"], float(req.get("score_threshold", 0.4)))
        send({"id": req_id, "ok": True, "results": results})
    except Exception as e:
        log(traceback.format_exc())
        send({"id": req_id, "ok": False, "error": str(e)})
