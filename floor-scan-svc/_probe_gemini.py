"""
Independent Gemini reachability probe. Runs OUTSIDE the /scan-gemini
endpoint but uses the SAME client-construction path (SSL, timeout,
prompt, config) so any failure here is directly attributable to Google
(or to that specific client config), not to FastAPI/uvicorn plumbing.

Usage: python _probe_gemini.py [image-path]
"""
import os, sys, time, json
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

# Reuse the exact client build & prompt from app.py — this is what makes
# the probe an honest apples-to-apples comparison with /scan-gemini.
from app import (
    _get_gemini_client, GEMINI_MODEL, GEMINI_FALLBACK_MODEL,
    GEMINI_CALL_TIMEOUT_MS, GEMINI_PROMPT,
)
from google.genai import types
from PIL import Image
import cv2

if len(sys.argv) > 1:
    img_path = Path(sys.argv[1])
else:
    # Same test image the /scan-gemini smoke test used
    cands = sorted(HERE.glob("templates/chairs/*.png"))
    img_path = cands[0] if cands else None
if not img_path or not img_path.is_file():
    print("no test image"); sys.exit(1)

img_bgr = cv2.imread(str(img_path))
h, w = img_bgr.shape[:2]
img_pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
print(f"Test image: {img_path.name}  {w}x{h}  timeout={GEMINI_CALL_TIMEOUT_MS}ms")

client, err = _get_gemini_client()
if err:
    print("CLIENT INIT FAILED:", err); sys.exit(2)

def _one(model):
    t0 = time.time()
    try:
        resp = client.models.generate_content(
            model=model,
            contents=[types.Part.from_text(text=GEMINI_PROMPT), img_pil],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        dt = time.time() - t0
        n = 0
        try:
            n = len(json.loads(resp.text or "{}").get("objects", []) or [])
        except Exception:
            pass
        return {"model": model, "status": 200, "ms": int(dt*1000), "objects": n, "err": None}
    except Exception as e:
        dt = time.time() - t0
        code = getattr(e, "code", 0) or 0
        return {"model": model, "status": int(code) if code else 0,
                "ms": int(dt*1000), "objects": 0,
                "err": f"{type(e).__name__}: {str(e)[:180]}"}

results = []
for i in range(3):
    for m in (GEMINI_MODEL, GEMINI_FALLBACK_MODEL):
        r = _one(m); results.append(r)
        print(f"round={i+1}  {r['model']:22s}  status={r['status']:>3}  ms={r['ms']:>6}  objects={r['objects']}  err={r['err']}")
        time.sleep(1.5)

# Summary
from collections import Counter
c = Counter()
lat = {"3.7": [], "3.6": []}
for r in results:
    key = r["model"] + "  " + ("OK" if r["status"] == 200 else f"code={r['status']}")
    c[key] += 1
    lat["3.7" if "3.7" in r["model"] else "3.6"].append(r["ms"])
print("\nSUMMARY:")
for k,v in c.most_common(): print(f"  {v}x  {k}")
for k, v in lat.items():
    if v: print(f"  latency {k}: min={min(v)}ms  max={max(v)}ms  avg={sum(v)//len(v)}ms")
