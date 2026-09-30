"""
Diagnostic — dumps every raw Architect detection on the given image(s).

Purpose: answer the "A vs B vs C" question from the /scan-architect diagnosis.
    A = Architect detected 0 objects total
    B = Architect detected objects, but none were class 13 (chair) or 14 (table)
    C = Architect detected chair/table but our endpoint filtering discarded them

This script bypasses the endpoint entirely. It loads the same weights file the
service uses (architect_best.pt), runs inference on the local image with
NO class filter and a very low confidence threshold, and prints EVERY box
returned — class ID, class name, confidence, bounding box.

This changes NO production code. It only reads the weights file and any image
you point it at.

Usage:
    python diagnose_architect.py <image_path> [image_path...]
    python diagnose_architect.py c:/Mobilise/test_images/

Optional env:
    DIAG_CONF       confidence threshold (default 0.05, deliberately low)
    ARCHITECT_FILE  weights filename    (default architect_best.pt in this dir)
"""

import os
import sys
from pathlib import Path
from collections import Counter

import cv2

# The service's own weights, loaded exactly the same way.
HERE = Path(__file__).parent
WEIGHTS_PATH = HERE / os.environ.get("ARCHITECT_FILE", "architect_best.pt")
DIAG_CONF = float(os.environ.get("DIAG_CONF", "0.05"))

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def collect_paths(argv):
    paths = []
    for a in argv:
        p = Path(a)
        if p.is_dir():
            paths.extend(sorted(
                q for q in p.iterdir()
                if q.suffix.lower() in IMAGE_EXTS
            ))
        elif p.is_file():
            paths.append(p)
        else:
            print(f"[warn] not found: {a}")
    return paths


def diagnose_image(model, names, img_path):
    print("\n" + "=" * 70)
    print(f"IMAGE: {img_path}")
    print("=" * 70)

    img = cv2.imread(str(img_path))
    if img is None:
        print(f"  [!] cv2.imread returned None — file may be missing or unreadable")
        return

    h, w = img.shape[:2]
    print(f"  size (WxH):        {w}x{h}")
    print(f"  weights:           {WEIGHTS_PATH}")
    print(f"  conf threshold:    {DIAG_CONF}")
    print(f"  class filter:      NONE (all 28 classes considered)")
    print()

    # Run the model with NO class filter, low confidence.
    # This is EXACTLY what /scan-architect does minus the classes=[...] arg.
    results = model(img, verbose=False, conf=DIAG_CONF)[0]

    n = len(results.boxes)
    print(f"  RAW DETECTIONS: {n}")
    print()

    if n == 0:
        print("  Diagnosis for THIS image at conf=%.2f: A (model produced 0 detections total)"
              % DIAG_CONF)
        print("  This means the model did not find ANY of its 28 known classes above the")
        print("  low confidence bar in this image. Not just chair/table — nothing.")
        return

    # Per-class summary first (easy to eyeball).
    by_class = Counter()
    for box in results.boxes:
        cls = int(box.cls[0])
        by_class[cls] += 1

    print("  Per-class count (all 28 classes considered):")
    for cls in sorted(by_class.keys()):
        cname = names.get(cls, f"cls-{cls}")
        star = "  <-- our target" if cls in (13, 14) else ""
        print(f"    class {cls:2d} ({cname:20s}): {by_class[cls]:3d}{star}")
    print()

    n_target = by_class.get(13, 0) + by_class.get(14, 0)
    if n_target == 0:
        print("  Diagnosis for THIS image: B (model detected objects, but NONE were")
        print("  class 13 chair or class 14 table). The endpoint's classes=[13,14] filter")
        print("  correctly returned 0/0/0.")
    else:
        print(f"  Diagnosis for THIS image: model detected {n_target} chair/table object(s)")
        print("  at low confidence. If /scan-architect returned 0/0/0 for the same image,")
        print("  the difference is the ARCHITECT_CONF threshold (currently 0.25 in the")
        print("  service) versus this diagnostic's %.2f threshold." % DIAG_CONF)

    print()
    print("  Full detection dump (class, conf, bbox x1,y1,x2,y2):")
    # Sort by confidence descending — makes triage easier.
    rows = []
    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        rows.append((cls, conf, x1, y1, x2, y2))
    rows.sort(key=lambda r: -r[1])

    print(f"    {'cls':>3s} {'name':<22s} {'conf':>6s}  {'x1':>5s} {'y1':>5s} {'x2':>5s} {'y2':>5s}")
    for cls, conf, x1, y1, x2, y2 in rows:
        cname = names.get(cls, f"cls-{cls}")
        marker = " *chair*" if cls == 13 else (" *table*" if cls == 14 else "")
        print(f"    {cls:>3d} {cname:<22s} {conf:>6.3f}  "
              f"{x1:>5.0f} {y1:>5.0f} {x2:>5.0f} {y2:>5.0f}{marker}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    if not WEIGHTS_PATH.is_file():
        print(f"[fatal] weights file not found: {WEIGHTS_PATH}")
        print(f"        set ARCHITECT_FILE env var, or place architect_best.pt next to this script")
        sys.exit(2)

    paths = collect_paths(sys.argv[1:])
    if not paths:
        print("No images found. Provide file(s) or a folder.")
        sys.exit(1)

    # Load the exact same weights the service loads. This does NOT touch the
    # running service — Ultralytics just loads a fresh copy into this process.
    print(f"Loading Architect weights: {WEIGHTS_PATH}")
    from ultralytics import YOLO
    model = YOLO(str(WEIGHTS_PATH))
    names = dict(model.names)
    print(f"Model ready. Classes: {len(names)}")
    print(f"  class 13 = {names.get(13)!r}")
    print(f"  class 14 = {names.get(14)!r}")

    for p in paths:
        diagnose_image(model, names, p)

    print("\nDone.")


if __name__ == "__main__":
    main()
