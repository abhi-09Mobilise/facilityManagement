"""
Empirical benchmark — free/local pretrained detectors NOT previously tested.

Contenders:
  1. YOLOv8m COCO          (Ultralytics, standard COCO classes)
  2. RT-DETR-L COCO        (Ultralytics, standard COCO classes)
  3. YOLO-World v2-L       (Ultralytics, open-vocabulary via text prompts)
  4. Grounding DINO tiny   (transformers, open-vocabulary via text prompts)

All run on CPU. Confidence threshold intentionally LOW so we see anything
the model even considered — no threshold tuning tricks.

Skipped (justified inline in the code):
  - Florence-2 (~230 MB weights + more transformers setup, similar behaviour
    profile to Grounding DINO)
  - OWLv2 (~600 MB, similar to Grounding DINO)
  - "YOLO26" — no stable public release verified

Usage:
    python benchmark_free_models.py <image> [image ...]
"""

import os
import sys
import time
from pathlib import Path
from collections import Counter

import cv2
from ultralytics import YOLO


HERE = Path(__file__).parent

# Confidence intentionally low so we see borderline detections too.
CONF = 0.05

# Text prompts we try for open-vocabulary detectors. Order matters — first
# prompt goes into the "canonical" class name for the summary table.
OV_PROMPTS = [
    "chair", "table", "round table", "rectangular table",
    "dining chair", "office chair",
]

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


# ---------------------------------------------------------------------------
# Detector wrappers — each returns (per_class_counter, top_conf_by_class,
# elapsed_ms, notes)
# ---------------------------------------------------------------------------

def bench_yolov8m(img):
    """YOLOv8m COCO — standard classes."""
    from ultralytics.utils import LOGGER
    LOGGER.setLevel("ERROR")
    if not hasattr(bench_yolov8m, "model"):
        bench_yolov8m.model = YOLO("yolov8m.pt")  # auto-downloads
    t0 = time.time()
    r = bench_yolov8m.model(img, verbose=False, conf=CONF)[0]
    ms = (time.time() - t0) * 1000
    names = bench_yolov8m.model.names
    per_class = Counter()
    top = {}
    for b in r.boxes:
        cls = int(b.cls[0]); conf = float(b.conf[0])
        nm = names[cls]
        per_class[nm] += 1
        top[nm] = max(top.get(nm, 0), conf)
    return per_class, top, ms, ""


def bench_rtdetrl(img):
    """RT-DETR-L COCO — transformer detector, COCO classes."""
    from ultralytics.utils import LOGGER
    LOGGER.setLevel("ERROR")
    if not hasattr(bench_rtdetrl, "model"):
        bench_rtdetrl.model = YOLO("rtdetr-l.pt")  # auto-downloads via Ultralytics
    t0 = time.time()
    r = bench_rtdetrl.model(img, verbose=False, conf=CONF)[0]
    ms = (time.time() - t0) * 1000
    names = bench_rtdetrl.model.names
    per_class = Counter()
    top = {}
    for b in r.boxes:
        cls = int(b.cls[0]); conf = float(b.conf[0])
        nm = names[cls]
        per_class[nm] += 1
        top[nm] = max(top.get(nm, 0), conf)
    return per_class, top, ms, ""


def bench_yolo_world(img):
    """YOLO-World v2-L — open-vocabulary, we set custom class list."""
    from ultralytics.utils import LOGGER
    LOGGER.setLevel("ERROR")
    if not hasattr(bench_yolo_world, "model"):
        bench_yolo_world.model = YOLO("yolov8l-worldv2.pt")  # auto-downloads
        bench_yolo_world.model.set_classes(OV_PROMPTS)
    t0 = time.time()
    r = bench_yolo_world.model(img, verbose=False, conf=CONF)[0]
    ms = (time.time() - t0) * 1000
    per_class = Counter()
    top = {}
    for b in r.boxes:
        cls = int(b.cls[0]); conf = float(b.conf[0])
        nm = OV_PROMPTS[cls] if cls < len(OV_PROMPTS) else f"cls-{cls}"
        per_class[nm] += 1
        top[nm] = max(top.get(nm, 0), conf)
    return per_class, top, ms, f"prompts={OV_PROMPTS}"


def bench_grounding_dino(img):
    """Grounding DINO tiny — open-vocabulary via transformers."""
    if not hasattr(bench_grounding_dino, "model"):
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        import torch as _torch
        model_id = "IDEA-Research/grounding-dino-tiny"
        bench_grounding_dino.processor = AutoProcessor.from_pretrained(model_id)
        bench_grounding_dino.model = (
            AutoModelForZeroShotObjectDetection.from_pretrained(model_id).eval()
        )
        bench_grounding_dino.torch = _torch
    proc = bench_grounding_dino.processor
    model = bench_grounding_dino.model
    torch = bench_grounding_dino.torch

    # Grounding DINO expects PIL RGB, not BGR ndarray.
    from PIL import Image
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    text = ". ".join(OV_PROMPTS) + "."  # dot-separated with trailing dot

    t0 = time.time()
    inputs = proc(images=pil, text=text, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)
    results = proc.post_process_grounded_object_detection(
        outputs,
        input_ids=inputs.input_ids,
        target_sizes=[pil.size[::-1]],  # (h, w)
        threshold=CONF,
        text_threshold=CONF,
    )[0]
    ms = (time.time() - t0) * 1000

    per_class = Counter()
    top = {}
    labels = results.get("labels", results.get("text_labels", []))
    scores = results.get("scores", [])
    for lbl, sc in zip(labels, scores):
        s = float(sc)
        nm = str(lbl).strip().lower() or "?"
        per_class[nm] += 1
        top[nm] = max(top.get(nm, 0.0), s)
    return per_class, top, ms, f"prompts={OV_PROMPTS}"


DETECTORS = [
    ("YOLOv8m COCO",       bench_yolov8m),
    ("RT-DETR-L COCO",     bench_rtdetrl),
    ("YOLO-World v2-L",    bench_yolo_world),
    ("Grounding DINO tiny", bench_grounding_dino),
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

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


def summarize_counter(c):
    if not c:
        return "(nothing)"
    return ", ".join(f"{n}×{k}" for k, n in c.most_common())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    paths = collect_paths(sys.argv[1:])
    if not paths:
        print("No images.")
        sys.exit(1)

    # (image, model_name) -> (chair_count, table_count, total, top_chair_conf, top_table_conf, ms, notes)
    grid = {}

    for p in paths:
        img = cv2.imread(str(p))
        if img is None:
            print(f"[skip] cannot read {p}")
            continue
        h, w = img.shape[:2]
        print("=" * 90)
        print(f"IMAGE: {p.name}  ({w}x{h})")
        print("=" * 90)

        for name, fn in DETECTORS:
            try:
                per, top, ms, notes = fn(img)
            except Exception as e:
                print(f"\n  [{name}]  FAILED: {type(e).__name__}: {str(e)[:180]}")
                grid[(p.name, name)] = (0, 0, 0, 0.0, 0.0, 0, f"error: {type(e).__name__}")
                continue

            # Aggregate "chair-like" and "table-like" tags. Different models
            # emit different label spellings, especially the open-vocab ones,
            # so we bucket by substring match.
            chair_ct = sum(v for k, v in per.items() if "chair" in k.lower())
            table_ct = sum(v for k, v in per.items() if "table" in k.lower())
            top_ch = max((v for k, v in top.items() if "chair" in k.lower()), default=0.0)
            top_tb = max((v for k, v in top.items() if "table" in k.lower()), default=0.0)

            total = sum(per.values())
            print(f"\n  [{name}]  {ms:5.0f} ms  |  total={total:3d}  chair={chair_ct:3d}  table={table_ct:3d}")
            print(f"    top chair conf: {top_ch:.3f}    top table conf: {top_tb:.3f}")
            print(f"    per-class     : {summarize_counter(per)}")

            grid[(p.name, name)] = (chair_ct, table_ct, total, top_ch, top_tb, int(ms), notes)

        print()

    # -----------------------------------------------------------------
    # Grand summary
    # -----------------------------------------------------------------
    print("\n" + "=" * 120)
    print("SUMMARY (conf=%.2f, all models)" % CONF)
    print("=" * 120)
    print(f"{'image':38s} {'model':22s} {'total':>6s} {'chair':>6s} {'table':>6s} {'ch.conf':>8s} {'tb.conf':>8s} {'ms':>6s}")
    print("-" * 120)
    for (img_name, model_name), (ch, tb, total, tc, tt, ms, _) in sorted(grid.items()):
        print(f"{img_name[:38]:38s} {model_name:22s} {total:>6d} {ch:>6d} {tb:>6d} {tc:>8.3f} {tt:>8.3f} {ms:>6d}")


if __name__ == "__main__":
    main()
