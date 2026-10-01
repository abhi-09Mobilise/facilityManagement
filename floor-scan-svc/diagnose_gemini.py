"""
Diagnostic — benchmark Gemini 2.5 Pro on architectural floor-plan furniture
detection. Isolated from the production service.

DOES NOT modify /scan, /scan-yolo, /scan-architect, or any Node/front-end code.

What it does:
  1. Load the API key from GEMINI_API_KEY env var (never hard-coded).
  2. For each image, send the full-resolution image to Gemini 2.5 Pro with a
     strict prompt asking for one bbox per chair and per table.
  3. Parse Gemini's response as JSON (using the SDK's structured output).
  4. Convert Gemini's normalized [ymin, xmin, ymax, xmax] boxes (0..1000
     scale, as documented) into pixel [x1, y1, x2, y2] and validate.
  5. Draw the detections on a copy of the image and save under
     ./gemini_results/<image_stem>_gemini.png.
  6. Report per-image counts, response latency, token usage, and any
     malformed / out-of-bounds / suspicious boxes.

Usage:
    python diagnose_gemini.py <image> [image ...]
    python diagnose_gemini.py <folder>

Env vars:
    GEMINI_API_KEY   required
    GEMINI_MODEL     optional (default: gemini-2.5-pro)
    GEMINI_CONF      optional confidence filter for what we DRAW (default 0.0,
                     i.e. draw all — model doesn't produce calibrated scores
                     the way YOLO does; we accept everything Gemini returns)
"""

import json
import os
import sys
import time
from pathlib import Path
from collections import Counter

import cv2
from PIL import Image


HERE = Path(__file__).parent
OUT_DIR = HERE / "gemini_results"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()


# The prompt Gemini receives. Very strict — one bbox per object, only chair
# and table, ignore everything else. Follows Google's documented convention:
# box_2d in normalized 0..1000 coordinates, [ymin, xmin, ymax, xmax].
PROMPT = """You are an expert at reading architectural floor plans.

Detect EVERY chair symbol and EVERY table symbol drawn in this floor plan.
Return one bounding box per object.

Strict rules:
- One box per chair — do NOT group multiple chairs into a single detection.
- One box per table.
- IGNORE all other architectural elements: doors, windows, walls, stairs,
  beds, sofas, cabinets, wardrobes, toilets, bath tubs, sinks, appliances,
  plants, decorative symbols, dimension lines, room labels, and text.
- Do NOT hallucinate furniture that is not clearly drawn.
- Pay attention to small chair symbols around dining/meeting/office tables.
- Look at the entire image, including corners and dense areas.

For each detected object return an object with:
  "class": "chair" or "table"
  "box_2d": [ymin, xmin, ymax, xmax] normalized to 0..1000
  "shape": "round" or "rectangular" (tables only; for chairs use "rectangular")
  "confidence": your subjective confidence 0.0..1.0

Return ONLY a JSON object with one key "objects" holding the array. No
prose, no markdown fences.
"""


# --------------------------------------------------------------------------
# Coordinate conversion — Google returns [ymin, xmin, ymax, xmax] on 0..1000
# --------------------------------------------------------------------------
def to_pixel_box(box_2d, img_w, img_h):
    if len(box_2d) != 4:
        return None
    y1n, x1n, y2n, x2n = box_2d
    if not all(isinstance(v, (int, float)) for v in box_2d):
        return None
    # Normalize (clip to 0..1000 in case model overshoots slightly)
    y1n = max(0, min(1000, y1n)); x1n = max(0, min(1000, x1n))
    y2n = max(0, min(1000, y2n)); x2n = max(0, min(1000, x2n))
    x1 = int(round(x1n / 1000.0 * img_w))
    y1 = int(round(y1n / 1000.0 * img_h))
    x2 = int(round(x2n / 1000.0 * img_w))
    y2 = int(round(y2n / 1000.0 * img_h))
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2, y2)


def draw_boxes(img_bgr, detections, out_path, banner):
    img = img_bgr.copy()
    counts = {"chair": 0, "table_round": 0, "table_rect": 0, "invalid": 0}
    h, w = img.shape[:2]

    for d in detections:
        cls = d.get("class", "").lower()
        shape = d.get("shape", "").lower()
        box = d.get("_pixel_box")  # attached earlier
        if not box:
            counts["invalid"] += 1
            continue
        x1, y1, x2, y2 = box

        if cls == "chair":
            color = (0, 200, 0)   # green
            label = f"chair"
            counts["chair"] += 1
        elif cls == "table" and shape == "round":
            color = (0, 140, 255)  # orange
            label = f"table_r"
            counts["table_round"] += 1
        elif cls == "table":
            color = (255, 120, 0)  # blue
            label = f"table_x"
            counts["table_rect"] += 1
        else:
            continue

        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        conf = d.get("confidence", 0)
        text = f"{label} {conf:.2f}" if isinstance(conf, (int, float)) else label
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
        cv2.rectangle(img, (x1, max(0, y1 - th - 4)), (x1 + tw + 4, y1), color, -1)
        cv2.putText(img, text, (x1 + 2, y1 - 3), cv2.FONT_HERSHEY_SIMPLEX,
                    0.4, (255, 255, 255), 1, cv2.LINE_AA)

    # Banner at top
    bh = 40
    cv2.rectangle(img, (0, 0), (w, bh), (30, 30, 30), -1)
    cv2.putText(img, banner, (10, 18), cv2.FONT_HERSHEY_SIMPLEX,
                0.55, (255, 255, 255), 1, cv2.LINE_AA)
    line2 = f"chairs={counts['chair']}  round={counts['table_round']}  rect={counts['table_rect']}  invalid={counts['invalid']}"
    cv2.putText(img, line2, (10, 34), cv2.FONT_HERSHEY_SIMPLEX,
                0.45, (200, 220, 255), 1, cv2.LINE_AA)

    cv2.imwrite(str(out_path), img)
    return counts


def call_gemini(client, img_path, img_w, img_h):
    """Send one image + prompt. Return (raw_text, parsed_dict, usage_meta, elapsed_ms)."""
    from google.genai import types

    img_pil = Image.open(img_path)
    t0 = time.time()
    resp = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_text(text=PROMPT),
            img_pil,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,  # deterministic
        ),
    )
    ms = (time.time() - t0) * 1000.0

    text = resp.text or ""
    parsed = None
    err = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        # Sometimes Gemini wraps in ```json ... ``` despite the mime hint.
        stripped = text.strip().lstrip("`").rstrip("`")
        for tag in ("json\n", "JSON\n", "json ", "JSON "):
            if stripped.startswith(tag):
                stripped = stripped[len(tag):]
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            err = str(e)

    usage = {}
    um = getattr(resp, "usage_metadata", None)
    if um is not None:
        usage = {
            "prompt_tokens": getattr(um, "prompt_token_count", None),
            "output_tokens": getattr(um, "candidates_token_count", None),
            "total_tokens": getattr(um, "total_token_count", None),
        }

    return text, parsed, err, usage, ms


def process_image(client, path):
    print("\n" + "=" * 90)
    print(f"IMAGE: {path.name}")
    print("=" * 90)

    img_bgr = cv2.imread(str(path))
    if img_bgr is None:
        print(f"  [!] could not read {path}")
        return None
    h, w = img_bgr.shape[:2]
    print(f"  size (WxH): {w}x{h}")

    print(f"  calling {MODEL} ...")
    raw, parsed, err, usage, ms = call_gemini(client, path, w, h)
    print(f"  response: {ms:.0f} ms   tokens: {usage}")

    if err:
        print(f"  [!] JSON parse error: {err}")
        print(f"  raw response first 400 chars: {raw[:400]!r}")
        return {
            "image": path.name, "wxh": (w, h), "ms": ms, "usage": usage,
            "chairs": 0, "tables_round": 0, "tables_rect": 0, "invalid": 0,
            "error": f"json parse: {err}",
        }

    if not parsed or "objects" not in parsed:
        print(f"  [!] response missing 'objects' key: {parsed}")
        return {
            "image": path.name, "wxh": (w, h), "ms": ms, "usage": usage,
            "chairs": 0, "tables_round": 0, "tables_rect": 0, "invalid": 0,
            "error": "missing objects key",
        }

    detections = parsed.get("objects", []) or []
    # Convert every detection's box to pixel space; keep original attached.
    for d in detections:
        px = to_pixel_box(d.get("box_2d"), w, h)
        d["_pixel_box"] = px

    # Filter obviously bad
    valid = [d for d in detections if d.get("_pixel_box")]
    invalid_ct = len(detections) - len(valid)

    per_class = Counter()
    for d in valid:
        cls = d.get("class", "").lower()
        if cls == "table":
            shape = d.get("shape", "rectangular").lower()
            per_class[f"table_{'round' if shape == 'round' else 'rect'}"] += 1
        elif cls == "chair":
            per_class["chair"] += 1
        else:
            per_class[f"other:{cls}"] += 1

    print(f"  raw detections: {len(detections)}   valid boxes: {len(valid)}   invalid: {invalid_ct}")
    print(f"  per-class     : {dict(per_class)}")

    # Save raw JSON for auditability
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / f"{path.stem}_gemini.json").write_text(
        json.dumps({"model": MODEL, "usage": usage, "ms_elapsed": ms,
                    "image_size": [w, h], "objects": [
                        {k: v for k, v in d.items() if k != "_pixel_box"}
                        for d in detections
                    ]}, indent=2), encoding="utf-8"
    )

    # Draw visualization
    banner = f"Gemini 2.5 Pro | {path.name} ({w}x{h})"
    out_png = OUT_DIR / f"{path.stem}_gemini.png"
    counts = draw_boxes(img_bgr, valid, out_png, banner)
    print(f"  visualization -> {out_png}")

    return {
        "image": path.name, "wxh": (w, h), "ms": ms, "usage": usage,
        "chairs": counts["chair"],
        "tables_round": counts["table_round"],
        "tables_rect": counts["table_rect"],
        "invalid": counts["invalid"] + invalid_ct,
        "error": None,
    }


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
    if not API_KEY:
        print("[fatal] GEMINI_API_KEY env var is empty. Set it before running.")
        sys.exit(2)

    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    paths = collect_paths(sys.argv[1:])
    if not paths:
        print("No images.")
        sys.exit(1)

    OUT_DIR.mkdir(exist_ok=True)

    # google-genai client
    from google import genai
    client = genai.Client(api_key=API_KEY)

    print(f"Model:  {MODEL}")
    print(f"Images: {len(paths)}")
    print(f"Output: {OUT_DIR.resolve()}\n")

    reports = []
    for p in paths:
        try:
            r = process_image(client, p)
            if r:
                reports.append(r)
        except Exception as e:
            print(f"  [!] EXCEPTION processing {p}: {type(e).__name__}: {e}")
            reports.append({"image": p.name, "error": f"{type(e).__name__}: {e}"})

    # Summary
    print("\n\n" + "=" * 110)
    print("SUMMARY")
    print("=" * 110)
    print(f"{'image':40s} {'size':>11s} {'chairs':>7s} {'round':>6s} {'rect':>5s} {'invalid':>8s} {'ms':>6s} {'tokens':>18s}")
    print("-" * 110)
    total_in = total_out = 0
    for r in reports:
        if r.get("error"):
            print(f"{r['image'][:40]:40s}  ERROR: {r['error']}")
            continue
        w, h = r["wxh"]
        pt = (r["usage"].get("prompt_tokens") or 0)
        ot = (r["usage"].get("output_tokens") or 0)
        total_in += pt
        total_out += ot
        print(f"{r['image'][:40]:40s} {f'{w}x{h}':>11s} {r['chairs']:>7d} {r['tables_round']:>6d} {r['tables_rect']:>5d} {r['invalid']:>8d} {r['ms']:>6.0f} {f'{pt}+{ot}':>18s}")

    print("-" * 110)
    print(f"TOTAL tokens: prompt={total_in}  output={total_out}  ({total_in + total_out} total)")

    # Rough cost estimate (Gemini 2.5 Pro published Aug 2025 pricing — verify current at ai.google.dev/pricing)
    # $1.25 / 1M input (<=200k prompt), $10 / 1M output — image tokens rolled into prompt count.
    in_cost = total_in * 1.25 / 1e6
    out_cost = total_out * 10 / 1e6
    print(f"Approx cost this run @ Gemini 2.5 Pro published pricing:  ${in_cost + out_cost:.4f}  "
          f"(input ${in_cost:.4f} + output ${out_cost:.4f})")
    print(f"Visualizations in: {OUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
