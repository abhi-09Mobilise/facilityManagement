"""
Isolated pipeline-timing diagnostic. Measures the EXACT stages that
`/scan-gemini` runs per request, at multiple image sizes.

Stages measured:
  file_read_ms       : disk read to bytes
  imdecode_ms        : cv2.imdecode(bytes) -> BGR ndarray
  preprocess_ms      : cv2.cvtColor(BGR->RGB) + PIL.Image.fromarray
  gemini_ms          : one live client.models.generate_content() call
                       (same client, same timeout, same prompt, same
                        AFC-disabled config as production)
  total_pipeline_ms  : file_read + imdecode + preprocess + gemini

Also reports:
  original file size (bytes)
  decoded WxH
  total pixels
  detected image format (via magic bytes)
  raw usage_metadata dict from the SDK

No production code is modified. Read-only diagnostic.
"""
from __future__ import annotations
import sys, os, time, json
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import app as svc
from google.genai import types
import cv2
from PIL import Image


def _fmt_from_bytes(b: bytes) -> str:
    if b[:8] == b"\x89PNG\r\n\x1a\n": return "PNG"
    if b[:3] == b"\xff\xd8\xff":      return "JPEG"
    if b[:2] == b"BM":                return "BMP"
    if b[:6] in (b"GIF87a", b"GIF89a"): return "GIF"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return "WEBP"
    return "unknown"


def measure(img_path: Path, client) -> dict:
    print("=" * 78)
    print(f"IMAGE: {img_path}")

    # file_read
    t0 = time.time()
    with open(img_path, "rb") as f:
        raw = f.read()
    file_read_ms = int((time.time() - t0) * 1000)

    fmt = _fmt_from_bytes(raw[:16])
    file_bytes = len(raw)

    # imdecode
    import numpy as np
    t0 = time.time()
    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    imdecode_ms = int((time.time() - t0) * 1000)
    if img_bgr is None:
        print("  [!] cv2 could not decode"); return {}
    h_img, w_img = img_bgr.shape[:2]
    channels = img_bgr.shape[2] if img_bgr.ndim == 3 else 1
    total_pixels = w_img * h_img

    # preprocess (BGR->RGB + PIL)
    t0 = time.time()
    img_pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    preprocess_ms = int((time.time() - t0) * 1000)

    print(f"  file_size          : {file_bytes} bytes ({file_bytes/1024:.1f} KB)")
    print(f"  format             : {fmt}")
    print(f"  decoded_dims       : {w_img}x{h_img}")
    print(f"  total_pixels       : {total_pixels:,} ({total_pixels/1e6:.2f} MP)")
    print(f"  channels           : {channels}")
    print(f"  file_read_ms       : {file_read_ms}")
    print(f"  imdecode_ms        : {imdecode_ms}")
    print(f"  preprocess_ms      : {preprocess_ms}")

    # ONE gemini call against the primary model, same config as prod
    print(f"  gemini_model       : {svc.GEMINI_MODEL}")
    print(f"  gemini_read_timeout_ms : {svc.GEMINI_CALL_TIMEOUT_MS}")
    t0 = time.time()
    gemini_ms = None
    gemini_status = None
    gemini_err = None
    usage_dump = None
    resp_text = None
    try:
        resp = client.models.generate_content(
            model=svc.GEMINI_MODEL,
            contents=[types.Part.from_text(text=svc.GEMINI_PROMPT), img_pil],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        gemini_ms = int((time.time() - t0) * 1000)
        gemini_status = 200
        um = getattr(resp, "usage_metadata", None)
        if um is not None and hasattr(um, "model_dump"):
            usage_dump = um.model_dump(exclude_none=True)
        resp_text = (getattr(resp, "text", None) or "")[:150]
    except Exception as e:
        gemini_ms = int((time.time() - t0) * 1000)
        gemini_status = getattr(e, "code", 0) or 0
        gemini_err = f"{type(e).__name__}: {str(e)[:200]}"

    print(f"  gemini_status      : {gemini_status}")
    print(f"  gemini_ms          : {gemini_ms}")
    if gemini_err:
        print(f"  gemini_err         : {gemini_err}")
    if usage_dump is not None:
        print(f"  usage_metadata     : {json.dumps(usage_dump, default=str)}")
        # Reconcile total vs sum
        pt = usage_dump.get("prompt_token_count", 0) or 0
        ct = usage_dump.get("candidates_token_count", 0) or 0
        tt = usage_dump.get("total_token_count", 0) or 0
        th = usage_dump.get("thoughts_token_count", 0) or 0
        tu = usage_dump.get("tool_use_prompt_token_count", 0) or 0
        cc = usage_dump.get("cached_content_token_count", 0) or 0
        summed = pt + ct + th + tu
        diff = tt - summed
        print(f"  token_reconcile    : prompt({pt}) + candidates({ct}) + thoughts({th}) + tool_use({tu}) = {summed}  vs total({tt})  diff={diff}")
        if usage_dump.get("prompt_tokens_details"):
            print(f"  prompt_modality    : {usage_dump['prompt_tokens_details']}")
    if resp_text:
        print(f"  resp_first_150     : {resp_text!r}")

    total_pipeline_ms = file_read_ms + imdecode_ms + preprocess_ms + (gemini_ms or 0)
    print(f"  total_pipeline_ms  : {total_pipeline_ms}")
    print()
    return {
        "path": str(img_path), "format": fmt, "file_bytes": file_bytes,
        "w": w_img, "h": h_img, "mp": total_pixels/1e6,
        "file_read_ms": file_read_ms, "imdecode_ms": imdecode_ms,
        "preprocess_ms": preprocess_ms, "gemini_ms": gemini_ms,
        "gemini_status": gemini_status, "total_pipeline_ms": total_pipeline_ms,
        "usage_metadata": usage_dump,
    }


def main():
    if len(sys.argv) < 2:
        print("usage: python diagnose_upload_pipeline.py <img1> [img2 ...]")
        sys.exit(1)

    client, err = svc._get_gemini_client()
    if client is None:
        print(f"[fatal] cannot init Gemini client: {err}")
        sys.exit(2)

    results = []
    for p in sys.argv[1:]:
        r = measure(Path(p), client)
        if r: results.append(r)

    # Compact comparison table
    print("=" * 100)
    print("COMPARISON")
    print("=" * 100)
    hdr = ("image", "dims", "MP", "bytes", "fmt", "decode", "prep", "gemini", "total", "http")
    print(f"{hdr[0]:35s} {hdr[1]:>10s} {hdr[2]:>5s} {hdr[3]:>8s} {hdr[4]:>5s} {hdr[5]:>7s} {hdr[6]:>5s} {hdr[7]:>7s} {hdr[8]:>7s} {hdr[9]:>5s}")
    for r in results:
        name = Path(r["path"]).name
        print(f"{name[:35]:35s} {f'{r[chr(34)+chr(119)+chr(34)]}x{r[chr(34)+chr(104)+chr(34)]}':>10s} {r['mp']:>5.2f} {r['file_bytes']:>8d} {r['format']:>5s} {r['imdecode_ms']:>7d} {r['preprocess_ms']:>5d} {r['gemini_ms']:>7d} {r['total_pipeline_ms']:>7d} {r['gemini_status']:>5}")


if __name__ == "__main__":
    main()
