"""
Isolated Gemini model diagnostic + benchmark.

Two modes:
  1. HEALTH  (default) - text-only "Reply with exactly: OK" against every
     configured model. Answers "is this model responsive at all?"
  2. VISION  (--vision-model MODEL_NAME [--image PATH]) - fires the SAME
     production GEMINI_PROMPT + same image encoding + same client + same
     15s timeout at ONE model, one time, no retry, no fallback. Answers
     "does this model produce a usable floor-plan detection response?"

Reuses the project's existing _get_gemini_client() so the API key,
SSL context, httpx client, and per-call timeout are IDENTICAL to what
/scan-gemini uses in production. Nothing in this file mutates production
behaviour — safe to delete once diagnosis / benchmarking is complete.

Usage:
    # Text-only health check across all configured models
    python diagnose_gemini_models.py

    # Text health check against ONE arbitrary model
    python diagnose_gemini_models.py --text-model gemini-3.5-flash-lite

    # Vision benchmark against ONE model with the default test image
    python diagnose_gemini_models.py --vision-model gemini-3.5-flash-lite

    # Vision benchmark with a custom image
    python diagnose_gemini_models.py --vision-model gemini-3.5-flash-lite --image /path/to.png
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import app as svc  # imports config + _get_gemini_client (no YOLO load — that's lifespan)
from google.genai import types
import cv2
from PIL import Image


TEXT_PROMPT = "Reply with exactly: OK"


def _err_status(e: BaseException) -> int:
    c = getattr(e, "code", None)
    try:
        return int(c) if c is not None else 0
    except (TypeError, ValueError):
        return 0


def _category(status: int, exc):
    if exc is None:
        return "success"
    if status == 0:
        return f"client_error:{type(exc).__name__}"
    if status == 429:
        return "quota"
    if status == 400:
        return "bad_request"
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "model_not_found"
    if status in (500, 502, 503, 504):
        return "upstream_5xx"
    return f"other_{status}"


# ---------------------------------------------------------------------------
# TEXT test (no image, no fallback, no retry, one call)
# ---------------------------------------------------------------------------
def text_call(client, model_name: str) -> dict:
    print("=" * 78)
    print(f"MODE:  text-only health check")
    print(f"MODEL: {model_name}")
    print(f"TIMEOUT (from app.py): {svc.GEMINI_CALL_TIMEOUT_MS} ms")
    print(f"PROMPT: {TEXT_PROMPT!r}")
    started_at = datetime.now().isoformat(timespec="seconds")
    print(f"start_time: {started_at}")

    t0 = time.time()
    try:
        resp = client.models.generate_content(
            model=model_name,
            contents=[types.Part.from_text(text=TEXT_PROMPT)],
            config=types.GenerateContentConfig(
                temperature=0.0,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        ms = int((time.time() - t0) * 1000)
        text = (getattr(resp, "text", None) or "").strip()
        result = {
            "model": model_name, "start_time": started_at,
            "http_status": 200, "success": True, "latency_ms": ms,
            "response_text": text, "error_category": "success",
            "error_type": None, "error_msg": None,
        }
        # Dump usage metadata for the audit
        um = getattr(resp, "usage_metadata", None)
        print("  --- raw usage_metadata (text-only) ---")
        if um is None:
            print("    (none)")
        elif hasattr(um, "model_dump"):
            try:
                import json as _json
                print(f"    {_json.dumps(um.model_dump(exclude_none=False), default=str, indent=6)}")
            except Exception as _e:
                print(f"    dump failed: {_e}")
        print("  --- end usage_metadata ---")
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        status = _err_status(e)
        result = {
            "model": model_name, "start_time": started_at,
            "http_status": status, "success": False, "latency_ms": ms,
            "response_text": None,
            "error_category": _category(status, e),
            "error_type": type(e).__name__, "error_msg": str(e)[:240],
        }

    for k, v in result.items():
        if v is not None:
            print(f"  {k:16s}: {v!r}" if isinstance(v, str) else f"  {k:16s}: {v}")
    print()
    return result


# ---------------------------------------------------------------------------
# VISION test — reuses production GEMINI_PROMPT and same image encoding path
# ---------------------------------------------------------------------------
def _load_pil(img_path: Path):
    """Same decode path production uses: cv2.imread -> BGR->RGB -> PIL."""
    img_bgr = cv2.imread(str(img_path))
    if img_bgr is None:
        return None, None
    h, w = img_bgr.shape[:2]
    pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    return pil, (w, h)


def vision_call(client, model_name: str, img_path: Path) -> dict:
    print("=" * 78)
    print(f"MODE:  vision benchmark (SINGLE request, no fallback, no retry)")
    print(f"MODEL: {model_name}")
    print(f"IMAGE: {img_path}")
    print(f"TIMEOUT (from app.py): {svc.GEMINI_CALL_TIMEOUT_MS} ms")
    print(f"PROMPT: <production GEMINI_PROMPT, unchanged, {len(svc.GEMINI_PROMPT)} chars>")
    img_pil, dims = _load_pil(img_path)
    if img_pil is None:
        print("[!] could not read image"); return {"error": "cannot read image"}
    w_img, h_img = dims
    print(f"image_dims: {w_img}x{h_img}")
    started_at = datetime.now().isoformat(timespec="seconds")
    print(f"start_time: {started_at}")

    t0 = time.time()
    try:
        resp = client.models.generate_content(
            model=model_name,
            contents=[
                types.Part.from_text(text=svc.GEMINI_PROMPT),
                img_pil,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        ms = int((time.time() - t0) * 1000)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        status = _err_status(e)
        r = {
            "model": model_name, "start_time": started_at, "image_dims": [w_img, h_img],
            "http_status": status, "success": False, "latency_ms": ms,
            "raw_response_valid": False, "json_valid": False,
            "chairs": None, "tables_round": None, "tables_rect": None,
            "invalid_bboxes": None, "confidences": None,
            "error_category": _category(status, e),
            "error_type": type(e).__name__, "error_msg": str(e)[:400],
            "raw_first_400": None,
        }
        for k, v in r.items(): print(f"  {k:20s}: {v}")
        print()
        return r

    # ----- RAW usage_metadata dump (audit visibility) -----------------
    um = getattr(resp, "usage_metadata", None)
    print("  --- raw usage_metadata ---")
    if um is None:
        print("    (none returned by SDK)")
    else:
        print(f"    repr: {um!r}")
        print(f"    type: {type(um).__name__}")
        # Enumerate every non-callable, non-private attribute the object
        # exposes, plus try pydantic .model_dump() if available so nested
        # detail objects (modality breakdowns, etc.) surface as dicts.
        for attr in sorted(a for a in dir(um) if not a.startswith("_")):
            try:
                v = getattr(um, attr)
            except Exception as _e:
                print(f"    {attr}: <getattr raised {type(_e).__name__}>")
                continue
            if callable(v):
                continue
            print(f"    {attr}: {v!r}")
        if hasattr(um, "model_dump"):
            try:
                dumped = um.model_dump(exclude_none=False)
                import json as _json
                print(f"    model_dump(): {_json.dumps(dumped, default=str, indent=6)}")
            except Exception as _e:
                print(f"    model_dump() failed: {type(_e).__name__}: {_e}")
    print("  --- end usage_metadata ---")

    raw_text = (getattr(resp, "text", None) or "").strip()
    raw_valid = bool(raw_text)

    # Try JSON parse (same tolerance as production endpoint)
    parsed = None
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        stripped = raw_text.lstrip("`").rstrip("`").strip()
        for tag in ("json\n", "JSON\n", "json ", "JSON "):
            if stripped.startswith(tag):
                stripped = stripped[len(tag):]
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parsed = None

    json_valid = isinstance(parsed, dict) and isinstance(parsed.get("objects"), list)
    objects = parsed.get("objects", []) if json_valid else []

    chairs = round_tables = rect_tables = invalid = 0
    confidences = []
    for obj in objects:
        if not isinstance(obj, dict):
            invalid += 1; continue
        box = obj.get("box_2d")
        # bbox validity check — must be a 4-length list of numbers in 0..1000
        box_ok = (
            isinstance(box, (list, tuple)) and len(box) == 4
            and all(isinstance(v, (int, float)) for v in box)
            and box[2] > box[0] and box[3] > box[1]
        )
        if not box_ok:
            invalid += 1; continue
        cls = str(obj.get("class", "")).strip().lower()
        shape = str(obj.get("shape", "")).strip().lower()
        confidences.append(obj.get("confidence"))
        if cls == "chair":
            chairs += 1
        elif cls == "table" and shape == "round":
            round_tables += 1
        elif cls == "table":
            rect_tables += 1
        else:
            invalid += 1

    r = {
        "model": model_name, "start_time": started_at, "image_dims": [w_img, h_img],
        "http_status": 200, "success": True, "latency_ms": ms,
        "raw_response_valid": raw_valid, "json_valid": json_valid,
        "chairs": chairs, "tables_round": round_tables, "tables_rect": rect_tables,
        "invalid_bboxes": invalid,
        "confidences": confidences,
        "error_category": "success", "error_type": None, "error_msg": None,
        "raw_first_400": raw_text[:400],
    }
    for k, v in r.items(): print(f"  {k:20s}: {v}")
    print()
    return r


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-model", help="run text health check against one model")
    ap.add_argument("--vision-model", help="run vision benchmark against one model")
    ap.add_argument("--image", default=str(HERE / "templates" / "chairs" / "chair.png"),
                    help="image for vision benchmark")
    args = ap.parse_args()

    client, err = svc._get_gemini_client()
    if client is None:
        print(f"[fatal] could not initialise Gemini client: {err}"); sys.exit(2)

    if args.text_model:
        text_call(client, args.text_model)
    elif args.vision_model:
        vision_call(client, args.vision_model, Path(args.image))
    else:
        # Legacy default: text health across primary+fallback
        results = [
            text_call(client, svc.GEMINI_MODEL),
            text_call(client, svc.GEMINI_FALLBACK_MODEL),
        ]
        print("=" * 78); print("SUMMARY"); print("=" * 78)
        for r in results:
            line = f"{r['model']:24s}  "
            if r["success"]:
                line += f"OK    latency={r['latency_ms']:>6}ms  resp={r['response_text']!r}"
            else:
                line += (f"FAIL  latency={r['latency_ms']:>6}ms  "
                         f"http={r['http_status']}  cat={r['error_category']}")
            print(line)


if __name__ == "__main__":
    main()
