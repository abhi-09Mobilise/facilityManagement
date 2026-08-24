"""
Long-running Mask R-CNN worker for the Node backend.

Protocol
--------
Newline-delimited JSON over stdin / stdout.

On startup this script:
  1. Loads torchvision's Mask R-CNN (ResNet50 FPN v2, COCO weights) once.
     Weights auto-download to ~/.cache/torch/hub/checkpoints on first run
     (~180MB). Subsequent starts read from cache.
  2. Emits { "ready": true } to stdout so the Node wrapper knows the model
     is loaded and it's safe to send requests.

Then, for every stdin line, it expects a JSON object like:
  { "id": "42", "path": "C:/path/to/image.png", "score_threshold": 0.5 }

And emits, per request, one JSON line to stdout:
  { "id": "42", "ok": true, "results": [
      { "label": "chair", "score": 0.94,
        "box": [x1, y1, x2, y2],
        "mask_polygon": [[x, y], [x, y], ...] },   # optional, coarse contour
      ...
  ] }

On error:
  { "id": "42", "ok": false, "error": "<message>" }

All diagnostic logs go to stderr so they never confuse the JSON stdout
stream that the Node parent reads.

Run standalone for a quick smoke test:
  python mask_rcnn_service.py < some_requests.jsonl
"""

import sys
import json
import traceback

# ---------------------------------------------------------------------------
# stderr helpers so we never accidentally pollute stdout (which is JSON only).
# ---------------------------------------------------------------------------
def log(msg):
    sys.stderr.write("[mask-rcnn] " + msg + "\n")
    sys.stderr.flush()

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

# ---------------------------------------------------------------------------
# Model + inference. Kept inside a try so the ready signal captures import
# failures (missing torch / torchvision) instead of the parent hanging.
# ---------------------------------------------------------------------------
try:
    import torch
    from torchvision.models.detection import (
        maskrcnn_resnet50_fpn_v2,
        MaskRCNN_ResNet50_FPN_V2_Weights,
    )
    from torchvision.transforms import functional as TF
    from PIL import Image
    import numpy as np
except Exception as e:
    send({"ready": False, "error": "import failed: " + str(e)})
    sys.exit(1)

log("loading maskrcnn_resnet50_fpn_v2 (COCO weights)...")
weights = MaskRCNN_ResNet50_FPN_V2_Weights.DEFAULT
model = maskrcnn_resnet50_fpn_v2(weights=weights)
model.eval()
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device)
categories = weights.meta["categories"]  # list[str], index → COCO class name
log("device=" + str(device) + ", categories=" + str(len(categories)))
log("ready.")

send({"ready": True, "device": str(device), "categories": len(categories)})


def mask_to_polygon(mask, threshold=0.5, max_points=64):
    """
    Turn a HxW soft mask (float32 in [0,1]) into a coarse polygon by walking
    the boundary of the thresholded region and picking evenly-spaced points.
    We deliberately avoid pulling in opencv/skimage — the raw torch tensor is
    enough for a Mask R-CNN client that mostly wants boxes anyway.
    """
    m = (mask > threshold).astype(np.uint8)
    if m.sum() == 0:
        return None
    # Boundary pixels: cells that are 1 with any 0 neighbour.
    padded = np.pad(m, 1, constant_values=0)
    up    = padded[:-2, 1:-1]
    down  = padded[2:,  1:-1]
    left  = padded[1:-1, :-2]
    right = padded[1:-1, 2:]
    boundary = (m == 1) & ((up == 0) | (down == 0) | (left == 0) | (right == 0))
    ys, xs = np.where(boundary)
    if len(xs) == 0:
        return None
    # Down-sample to ~max_points evenly-spaced boundary pixels. Good enough
    # for hit-testing in the frontend; caller can request finer masks later.
    step = max(1, len(xs) // max_points)
    return [[int(x), int(y)] for x, y in zip(xs[::step], ys[::step])]


def detect(image_path, score_threshold=0.5, want_polygons=True):
    img = Image.open(image_path).convert("RGB")
    tensor = TF.to_tensor(img).to(device)
    with torch.no_grad():
        out = model([tensor])[0]

    boxes  = out["boxes"].detach().cpu().numpy()
    labels = out["labels"].detach().cpu().numpy()
    scores = out["scores"].detach().cpu().numpy()
    masks  = out["masks"].detach().cpu().numpy() if "masks" in out else None

    results = []
    for i in range(len(boxes)):
        s = float(scores[i])
        if s < score_threshold:
            continue
        idx = int(labels[i])
        label = categories[idx] if 0 <= idx < len(categories) else str(idx)
        box = [round(float(v), 2) for v in boxes[i].tolist()]
        item = {"label": label, "label_index": idx, "score": round(s, 4), "box": box}
        if want_polygons and masks is not None:
            poly = mask_to_polygon(masks[i, 0])
            if poly is not None:
                item["mask_polygon"] = poly
        results.append(item)
    return results


# ---------------------------------------------------------------------------
# Main loop — one request per stdin line.
# ---------------------------------------------------------------------------
for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        results = detect(
            req["path"],
            score_threshold=float(req.get("score_threshold", 0.5)),
            want_polygons=bool(req.get("want_polygons", True)),
        )
        send({"id": req_id, "ok": True, "results": results})
    except Exception as e:
        log("detect failed: " + str(e))
        log(traceback.format_exc())
        send({"id": req_id, "ok": False, "error": str(e)})
