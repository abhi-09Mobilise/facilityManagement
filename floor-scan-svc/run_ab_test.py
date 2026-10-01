"""
Consolidated benchmark — runs BOTH YOLO11m COCO and Architect (FloorPlanCAD)
against every image passed on the command line, at low confidence, with no
filter tricks, and prints raw per-class detection counts.

This is the source of truth for "which pretrained model can actually see
what in these floor plans". Everything else (Playwright E2E, /scan-yolo
endpoint, OpenCV fallback) is downstream plumbing — this script isolates the
MODEL from all of it.

Usage:
    python run_ab_test.py <image> [image ...]

    python run_ab_test.py <folder>            # all *.png/*.jpg inside

The report tells you, per image and per model:
  - total raw detections
  - per-class breakdown
  - target-class counts (chair, table for our project)
  - the highest-confidence chair/table detection
  - whether the model is "seeing" architectural furniture at all
"""

import os
import sys
from pathlib import Path
from collections import Counter

import cv2
from ultralytics import YOLO


HERE = Path(__file__).parent

# Same weights the running service uses.
YOLO_WEIGHTS      = HERE / "yolo11m.pt"
ARCHITECT_WEIGHTS = HERE / "architect_best.pt"

# Deliberately LOW confidence — we want to see everything the model even
# hesitates about, not just what the production 0.10/0.25 thresholds pass.
DIAG_CONF = 0.05

# Class indices for each model that map to our project's chair/table concepts.
YOLO_TARGETS = {56: "chair", 60: "dining_table"}
ARCH_TARGETS = {13: "chair", 14: "table"}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def load_image(p):
    img = cv2.imread(str(p))
    if img is None:
        return None, None
    h, w = img.shape[:2]
    return img, (w, h)


def run_model(model, names, img, targets):
    """
    Run the model on the image with no class filter and low conf.
    Returns (per_class_counter, target_class_counts, top_target_conf).
    """
    results = model(img, verbose=False, conf=DIAG_CONF)[0]
    per_class = Counter()
    target_hits = Counter()
    top_conf = {}
    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        per_class[cls] += 1
        if cls in targets:
            target_hits[targets[cls]] += 1
            top_conf[targets[cls]] = max(top_conf.get(targets[cls], 0.0), conf)
    return per_class, target_hits, top_conf


def summarize(per_class, names):
    if not per_class:
        return "(nothing)"
    rows = []
    for cls, cnt in per_class.most_common():
        nm = names.get(cls, f"cls-{cls}")
        rows.append(f"{cnt}×{nm}")
    return ", ".join(rows)


def collect_paths(argv):
    out = []
    for a in argv:
        p = Path(a)
        if p.is_dir():
            out.extend(sorted(q for q in p.iterdir() if q.suffix.lower() in IMAGE_EXTS))
        elif p.is_file():
            out.append(p)
        else:
            print(f"[warn] not found: {a}")
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    if not YOLO_WEIGHTS.is_file():
        print(f"[fatal] YOLO weights missing: {YOLO_WEIGHTS}")
        sys.exit(2)
    if not ARCHITECT_WEIGHTS.is_file():
        print(f"[fatal] Architect weights missing: {ARCHITECT_WEIGHTS}")
        sys.exit(2)

    print(f"Loading YOLO11m COCO ({YOLO_WEIGHTS.name}) ...")
    yolo = YOLO(str(YOLO_WEIGHTS))
    yolo_names = dict(yolo.names)
    print(f"  {len(yolo_names)} classes")

    print(f"Loading Architect FloorPlanCAD ({ARCHITECT_WEIGHTS.name}) ...")
    arch = YOLO(str(ARCHITECT_WEIGHTS))
    arch_names = dict(arch.names)
    print(f"  {len(arch_names)} classes")
    print(f"Confidence threshold used for BOTH: {DIAG_CONF}\n")

    paths = collect_paths(sys.argv[1:])
    if not paths:
        print("No images.")
        sys.exit(1)

    summary_rows = []

    for p in paths:
        img, dims = load_image(p)
        if img is None:
            print(f"[skip] cannot read {p}")
            continue
        w, h = dims

        print("=" * 78)
        print(f"IMAGE: {p.name}  ({w}x{h})")
        print("=" * 78)

        y_all, y_targets, y_top = run_model(yolo, yolo_names, img, YOLO_TARGETS)
        a_all, a_targets, a_top = run_model(arch, arch_names, img, ARCH_TARGETS)

        y_chair = y_targets.get("chair", 0)
        y_table = y_targets.get("dining_table", 0)
        a_chair = a_targets.get("chair", 0)
        a_table = a_targets.get("table", 0)

        print(f"\n  [YOLO11m COCO]      total={sum(y_all.values()):3d}  |  chair={y_chair:3d}  table={y_table:3d}")
        print(f"    top chair conf   : {y_top.get('chair', 0):.3f}")
        print(f"    top table conf   : {y_top.get('dining_table', 0):.3f}")
        print(f"    per-class        : {summarize(y_all, yolo_names)}")

        print(f"\n  [Architect FloorPlanCAD]  total={sum(a_all.values()):3d}  |  chair={a_chair:3d}  table={a_table:3d}")
        print(f"    top chair conf   : {a_top.get('chair', 0):.3f}")
        print(f"    top table conf   : {a_top.get('table', 0):.3f}")
        print(f"    per-class        : {summarize(a_all, arch_names)}")
        print()

        summary_rows.append((p.name, w, h,
                             sum(y_all.values()), y_chair, y_table,
                             sum(a_all.values()), a_chair, a_table))

    # Final compact table
    print("\n" + "=" * 100)
    print("SUMMARY (conf=%.2f, no class filter)" % DIAG_CONF)
    print("=" * 100)
    print(f"{'image':40s} {'size':>11s}  | {'YOLO total':>10s} {'chair':>6s} {'table':>6s}  | {'Arch total':>10s} {'chair':>6s} {'table':>6s}")
    print("-" * 100)
    for r in summary_rows:
        name, w, h, yt, yc, ytb, at, ac, atb = r
        print(f"{name[:40]:40s} {f'{w}x{h}':>11s}  | {yt:>10d} {yc:>6d} {ytb:>6d}  | {at:>10d} {ac:>6d} {atb:>6d}")


if __name__ == "__main__":
    main()
