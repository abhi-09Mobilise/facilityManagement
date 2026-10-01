"""
Floor-plan furniture detector.

Stands alongside the Node backend as its own HTTP service so we don't have
to compile native bindings in Node. Detection runs entirely in-memory; we
never persist the uploaded image.

Pipeline (architect-drawn plans, mixed style):
  1. Decode image -> grayscale.
  2. Adaptive binary threshold so we tolerate uneven brightness.
  3. Morphological close to heal small gaps in line work.
  4. Find external contours.
  5. Classify each contour by area + shape:
       chair        -> small, roughly square (aspect 0.6-1.4)
       table_round  -> larger, circularity > 0.75
       table_rect   -> larger, bounding-rect fill > 0.85, aspect 1.2-4
  6. Deduplicate near-overlaps with simple IoU check.
  7. Return {image_width, image_height, chairs, tables_round, tables_rect}.

Thresholds are env-tunable:
  CHAIR_MIN_PX_AREA       (default 120)     - reject contours smaller than this
  CHAIR_MAX_PX_AREA       (default 2500)    - upper bound for "chair"
  TABLE_MIN_PX_AREA       (default 2500)    - lower bound for "table"
  TABLE_MAX_PX_AREA       (default 90000)   - reject anything bigger (probably a room)
  CIRCULARITY_THRESHOLD   (default 0.75)    - round tables
  RECT_FILL_THRESHOLD     (default 0.85)    - rect tables (contour area / bbox area)
  DEDUPE_IOU              (default 0.5)     - dedupe near-overlaps

Run locally:
  pip install -r requirements.txt
  uvicorn app:app --host 0.0.0.0 --port 5001 --reload
"""

import io  # noqa: F401  (kept for symmetry with other IO paths; unused today)
import json
import math
import os
import ssl
import uuid
import logging
import time
from collections import Counter
from contextlib import asynccontextmanager
from typing import List, Dict, Any, Optional, Tuple

# NOTE ON SSL TRUST (Windows / Avast):
# We used to call `truststore.inject_into_ssl()` here as a process-wide
# monkey-patch. The problem: truststore reads the Windows cert store
# LAZILY on every TLS handshake, which means Avast's aswMonFltProxy
# filter driver gets a chance to deny access on every single Gemini
# request (intermittent PermissionError, killing the /scan-gemini flow).
#
# The Gemini client now builds its OWN httpx.Client with a pre-loaded
# in-memory PEM bundle snapshotted from the Windows cert store exactly
# ONCE at first use (see _load_windows_ca_pem + _build_gemini_httpx_client
# below). That single read is retried on PermissionError, and once the
# bundle is cached no further cert-store access is needed for any
# subsequent Gemini call.

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load .env from the service directory (GEMINI_API_KEY lives there).
# Silent no-op if the file is absent, so nothing breaks in envs that
# inject the key through the process environment directly.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass

# Template-matching layer. Runs before the contour-based pass and finds
# pixel-level matches for any sample chair/table icons the admin dropped
# into templates/<category>/. See templates_matcher.py for details and
# the README for "how to crop a good template".
from templates_matcher import (
    match_all_templates,
    template_count,
    TEMPLATE_MATCH_THRESHOLD,
    TEMPLATE_SCALES,
)

# YOLOv11 detector — powers the new /scan-yolo endpoint. Kept alongside the
# existing OpenCV pipeline so both can co-exist during the phased migration.
# Phase 1 (this file): expose /scan-yolo using pretrained COCO weights.
# Phase 2 (later): swap yolo11n.pt for a fine-tuned best.pt trained on
# labeled floor plans; add a fallback chain if the fine-tuned model returns
# nothing. No code changes on the Node backend or frontend for either phase.
from ultralytics import YOLO


# ----------------------------------------------------------------------
# Config (env-tunable so we can iterate without redeploying)
# ----------------------------------------------------------------------

def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

CHAIR_MIN_PX_AREA     = _f("CHAIR_MIN_PX_AREA",     30)
CHAIR_MAX_PX_AREA     = _f("CHAIR_MAX_PX_AREA",     15000)
TABLE_MIN_PX_AREA     = _f("TABLE_MIN_PX_AREA",     15000)
TABLE_MAX_PX_AREA     = _f("TABLE_MAX_PX_AREA",     30000)
CIRCULARITY_THRESHOLD = _f("CIRCULARITY_THRESHOLD", 0.5)
RECT_FILL_THRESHOLD   = _f("RECT_FILL_THRESHOLD",   0.5)
DEDUPE_IOU            = _f("DEDUPE_IOU",            0.5)

# Max upload size in bytes (10 MB by default) to avoid OOM on large CAD PNGs.
MAX_UPLOAD_BYTES = int(_f("MAX_UPLOAD_BYTES", 10 * 1024 * 1024))

# ---- YOLOv11 config -------------------------------------------------------
# YOLO_MODEL points at a weights file. Defaults to the pretrained medium
# model (~50 MB, auto-downloaded on first run). Medium (`m`) is the industry
# sweet spot for accuracy-first server workloads on CPU:
#   n (nano)   39.5 mAP   200 ms  — real-time / mobile / edge
#   s (small)  47.0 mAP   350 ms  — balanced
#   m (medium) 51.5 mAP   600 ms  — this pick, accuracy-first server ← default
#   l (large)  53.4 mAP   1100 ms — needs GPU realistically
#   x (xlarge) 54.7 mAP   2200 ms — research / GPU-only
# In Phase 2 this can be swapped to a fine-tuned best.pt without touching any
# other code. Override via the YOLO_MODEL env var if you need nano for speed
# on a low-spec box.
YOLO_MODEL_NAME     = os.environ.get("YOLO_MODEL", "yolo11m.pt")
# Lowered from 0.25 → 0.10 after real-world testing on user photos revealed
# YOLO was rejecting valid chair detections at 0.25 confidence in wide-angle
# / low-contrast / warm-lit conference-room photos. 0.10 accepts weaker hints
# so more photos succeed on the primary YOLO path (avoiding the OpenCV
# fallback below, which produces false positives on colour photos).
YOLO_CONF_THRESHOLD = _f("YOLO_CONF_THRESHOLD", 0.10)

# OpenCV fallback safety cap. Photos have rich textures (wood grain, leather,
# shadows) that match tiny chair template patches by accident, producing
# dozens of false positives. If the fallback returns more chairs than this,
# treat the whole detection as noise and discard.
OPENCV_FALLBACK_MAX_CHAIRS = int(_f("OPENCV_FALLBACK_MAX_CHAIRS", 40))

# COCO class indices YOLO returns that we care about for floor-plan detection.
# Per project scope: chairs, tables_rect, tables_round — nothing else.
# All other COCO classes (couch, bed, tv, laptop, person, ...) are filtered
# out at the source by passing classes=[...] to YOLO in scan_yolo() below.
# Full COCO class list: https://docs.ultralytics.com/datasets/detect/coco/
COCO_CHAIR         = 56   # "chair"        -> chairs bucket
COCO_DINING_TABLE  = 60   # "dining table" -> tables_round OR tables_rect
                          #                   (split by bounding-box aspect ratio;
                          #                   COCO doesn't distinguish shape)

# ---- Architect (SamirShabani/Architect) config ---------------------------
# Experimental endpoint /scan-architect uses YOLOv8m fine-tuned on FloorPlanCAD.
# Verified from https://huggingface.co/api/models/SamirShabani/Architect:
#   - base model: Ultralytics/YOLOv8
#   - weights file: best.pt
#   - license: cc-by-nc-4.0 (NON-COMMERCIAL — POC/demo only, NOT for prod SaaS)
#   - class 13 = 'chair', class 14 = 'table' (verified from README class list)
# Ultralytics YOLO() in 8.x treats a "user/repo" string as a local path, so we
# download best.pt explicitly via huggingface_hub and load it from disk.
ARCHITECT_ENABLED    = os.environ.get("ARCHITECT_ENABLED", "true").lower() == "true"
ARCHITECT_REPO       = os.environ.get("ARCHITECT_REPO", "SamirShabani/Architect")
ARCHITECT_FILE       = os.environ.get("ARCHITECT_FILE", "best.pt")
ARCHITECT_CONF       = _f("ARCHITECT_CONF", 0.25)
# Class indices verified from README (see comment block above).
ARCHITECT_CHAIR_ID   = 13
ARCHITECT_TABLE_ID   = 14

# ---- Gemini config -------------------------------------------------------
# Experimental endpoint /scan-gemini uses Google's gemini-3.7-flash vision
# model. Purpose: A/B comparison against /scan-yolo and /scan-architect on
# architectural floor-plan drawings, where local models struggle.
#
# The model returns bounding boxes as `box_2d: [ymin, xmin, ymax, xmax]`
# normalized to 0..1000 (Google's documented convention). We convert those
# to pixel coordinates and map onto the existing ScanResponse schema so the
# frontend needs zero changes.
#
# GEMINI_API_KEY is loaded from the process environment (or .env — see
# load_dotenv() call at the top of this file). If missing, /scan-gemini
# returns 503 rather than crashing the whole service.
#
# COST NOTE: Every /scan-gemini call is a paid API request. Do NOT route the
# main /api/floor-scan production traffic here without a rate limit and a
# per-tenant billing model in place.
GEMINI_ENABLED         = os.environ.get("GEMINI_ENABLED", "true").lower() == "true"
GEMINI_MODEL           = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
# Bounded transient-failure retry policy for the WHOLE primary→fallback
# ladder. When the ladder ends with a retryable-only failure we sleep
# with exponential backoff + jitter and rerun it up to
# GEMINI_MAX_LADDER_RETRIES additional times. Non-retryable errors (400/
# 401/403) break out immediately — no point retrying auth/config problems.
# Total worst-case latency = (1 + max_retries) × ~30s + backoffs; defaults
# keep it under Node's 90s AbortController budget.
GEMINI_MAX_LADDER_RETRIES = int(_f("GEMINI_MAX_LADDER_RETRIES", 1))
GEMINI_RETRY_BASE_S       = _f("GEMINI_RETRY_BASE_S", 1.0)
GEMINI_RETRY_MAX_S        = _f("GEMINI_RETRY_MAX_S", 4.0)
# Fallback used when the primary model returns any transient upstream
# error (404, 429, 500, 502, 503, 504, or client-side timeout). Set to
# empty string to disable fallback.
# NOTE: gemini-2.5-flash returns 404 for new API keys as of 2026-08 — Google
# explicitly recommends gemini-3.6-flash as the replacement in the 404 body.
# 2026-09 update: primary is now 3.6-flash (verified healthy in isolated
# benchmark); 3.5-flash-lite is the approved fallback (fast, valid JSON,
# production-parser compatible — see diagnose_gemini_models.py results).
GEMINI_FALLBACK_MODEL  = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite").strip()
# Per-call timeout, milliseconds. Empirically successful vision calls
# finish in 4-15s; anything past 15s is Google's endpoint stalling or
# returning DEADLINE_EXCEEDED (504). Cutting the timeout to 15s lets a
# broken call fail 10s sooner without cutting off any real success.
# Two attempts (primary + fallback, no same-model retry) → 30s worst-case
# UX vs the old 77s. Fits well inside the Node controller's 90s budget.
GEMINI_CALL_TIMEOUT_MS = int(_f("GEMINI_CALL_TIMEOUT_MS", 15_000))
GEMINI_API_KEY         = os.environ.get("GEMINI_API_KEY", "").strip()

# ---------------------------------------------------------------------------
# Pluggable AI provider — one env var flips between Gemini / Claude / OpenAI.
# The same prompt, same JSON schema, and same retry ladder are reused; only
# the SDK call is dispatched. To swap providers in production, set:
#     AI_PROVIDER=claude       and populate CLAUDE_API_KEY / CLAUDE_MODEL
#     AI_PROVIDER=openai       and populate OPENAI_API_KEY / OPENAI_MODEL
#     AI_PROVIDER=gemini       (default — existing behaviour, no change)
# No code changes are needed to switch. The frontend and Node backend never
# see which provider handled the request.
# ---------------------------------------------------------------------------
AI_PROVIDER            = os.environ.get("AI_PROVIDER", "gemini").strip().lower()

# ---- Claude (Anthropic) ---------------------------------------------------
CLAUDE_ENABLED         = os.environ.get("CLAUDE_ENABLED", "true").lower() == "true"
CLAUDE_MODEL           = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6").strip()
CLAUDE_FALLBACK_MODEL  = os.environ.get("CLAUDE_FALLBACK_MODEL", "claude-haiku-4-5").strip()
CLAUDE_CALL_TIMEOUT_MS = int(_f("CLAUDE_CALL_TIMEOUT_MS", 20_000))
CLAUDE_API_KEY         = os.environ.get("CLAUDE_API_KEY", "").strip()

# ---- OpenAI (ChatGPT) -----------------------------------------------------
OPENAI_ENABLED         = os.environ.get("OPENAI_ENABLED", "true").lower() == "true"
OPENAI_MODEL           = os.environ.get("OPENAI_MODEL", "gpt-4o").strip()
OPENAI_FALLBACK_MODEL  = os.environ.get("OPENAI_FALLBACK_MODEL", "gpt-4o-mini").strip()
OPENAI_CALL_TIMEOUT_MS = int(_f("OPENAI_CALL_TIMEOUT_MS", 20_000))
OPENAI_API_KEY         = os.environ.get("OPENAI_API_KEY", "").strip()

# Strict, deterministic prompt. Mirrors diagnose_gemini.py so the endpoint
# and the diagnostic script produce comparable output.
GEMINI_PROMPT = """You are an expert at reading architectural floor plans.

Detect EVERY chair symbol and EVERY table symbol drawn in this floor plan.
Return one bounding box per object.

Strict rules:
- One box per chair - do NOT group multiple chairs into a single detection.
- One box per table.
- IGNORE all other architectural elements: doors, windows, walls, stairs,
  beds, sofas, cabinets, wardrobes, toilets, bath tubs, sinks, appliances,
  plants, decorative symbols, dimension lines, room labels, and text.
- Do NOT hallucinate furniture that is not clearly drawn.
- Pay attention to small chair symbols around dining/meeting/office tables.
- Look at the entire image, including corners and dense areas.
- Computer monitors, CPUs, keyboards, and other computer equipment are NOT chairs and must NOT be detected as chairs.
- If computer equipment is placed on or associated with a clearly drawn desk or table, detect the desk/table as a table when it is clearly represented as a separate furniture object.
- Ignore only the computer equipment itself, do NOT ignore a clearly identifiable desk or table associated with it.

For each detected object return an object with:
  "class": "chair" or "table"
  "box_2d": [ymin, xmin, ymax, xmax] normalized to 0..1000
  "shape": "round" or "rectangular" (tables only; for chairs use "rectangular")
  "confidence": your subjective confidence 0.0..1.0

Return ONLY a JSON object with one key "objects" holding the array. No
prose, no markdown fences.
"""

logging.basicConfig(level=logging.INFO, format="[floor-scan] %(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("floor-scan")

# Heavy models (YOLO + Architect) are loaded inside the FastAPI lifespan
# startup handler below, NOT at module-import time. Reason: uvicorn `--reload`
# spawns a reloader parent process that ALSO imports app.py to know which
# files to watch. Loading the models at import-time then runs them twice
# (parent + worker), each costing ~50-100 MB RAM and a few hundred ms of
# CPU. Lifespan runs only in the worker, so the models load exactly once.
# In production (no --reload) there's no parent, so behaviour is identical.
_yolo = None
_architect = None
_architect_names: Dict[int, str] = {}


def _load_yolo():
    """Load the primary YOLOv11 detector into the module-level _yolo global."""
    global _yolo
    log.info("Loading YOLO model: %s", YOLO_MODEL_NAME)
    _yolo = YOLO(YOLO_MODEL_NAME)
    log.info("YOLO ready. Classes known: %d", len(_yolo.names))


def _load_architect():
    """Load the SamirShabani/Architect model IF enabled. Failures are non-fatal
    — /scan-architect returns 503 in that case but the rest of the service runs."""
    global _architect, _architect_names
    if not ARCHITECT_ENABLED:
        log.info("Architect model disabled (ARCHITECT_ENABLED=false). /scan-architect will return 503.")
        return
    try:
        # Prefer a pre-downloaded local file (see README: `curl -o architect_best.pt
        # https://huggingface.co/SamirShabani/Architect/resolve/main/best.pt`).
        # Fall back to huggingface_hub if we ever run in an env with proper SSL.
        # On Windows dev machines Python's requests library often can't verify
        # the HF cert without extra setup, so the pre-download path is safer.
        _local_arch = os.path.join(os.path.dirname(__file__), "architect_best.pt")
        if os.path.isfile(_local_arch):
            log.info("Loading Architect weights from local file: %s", _local_arch)
            _arch_path = _local_arch
        else:
            from huggingface_hub import hf_hub_download
            log.info("Downloading Architect weights: %s / %s", ARCHITECT_REPO, ARCHITECT_FILE)
            _arch_path = hf_hub_download(repo_id=ARCHITECT_REPO, filename=ARCHITECT_FILE)
            log.info("Architect weights at: %s", _arch_path)
        _architect = YOLO(_arch_path)
        _architect_names = dict(_architect.names)  # {int: str}
        log.info("Architect ready. Classes known: %d", len(_architect_names))
        # Log the ACTUAL class mapping so we can verify against the README.
        # If this doesn't include {13: 'chair', 14: 'table'} the endpoint will
        # refuse to answer (see /scan-architect below).
        for cid in sorted(_architect_names.keys()):
            log.debug("  Architect class %d = %r", cid, _architect_names[cid])
        # Sanity-check the two indices we rely on.
        got_chair = _architect_names.get(ARCHITECT_CHAIR_ID)
        got_table = _architect_names.get(ARCHITECT_TABLE_ID)
        if got_chair != "chair" or got_table != "table":
            log.warning(
                "Architect class-index mismatch! Expected {13:'chair', 14:'table'}, "
                "got {13:%r, 14:%r}. /scan-architect will still try to detect chair/table "
                "by NAME lookup rather than fixed index.",
                got_chair, got_table,
            )
    except Exception as e:
        log.error("Failed to load Architect model (%s/%s): %s. /scan-architect will return 503.",
                  ARCHITECT_REPO, ARCHITECT_FILE, e)
        _architect = None
        _architect_names = {}

# Gemini client is created lazily on first /scan-gemini request so the service
# starts fine when GEMINI_API_KEY is missing or google-genai isn't installed
# yet. See _get_gemini_client() for the actual initialisation.
_gemini_client = None
_gemini_client_error: str = ""
if GEMINI_ENABLED:
    if not GEMINI_API_KEY:
        log.info("Gemini disabled: GEMINI_API_KEY is empty. /scan-gemini will return 503.")
    else:
        log.info("Gemini enabled: model=%s (client will initialise on first request)", GEMINI_MODEL)
else:
    log.info("Gemini disabled (GEMINI_ENABLED=false). /scan-gemini will return 503.")


def _get_gemini_client():
    """
    Lazily construct the google-genai client on first use. Caches the
    resulting client on the module. Returns (client, error) — exactly one
    of them is non-None. Callers should raise 503 if error is set.
    """
    global _gemini_client, _gemini_client_error
    if _gemini_client is not None:
        return _gemini_client, ""
    if _gemini_client_error:
        return None, _gemini_client_error
    if not GEMINI_ENABLED:
        _gemini_client_error = "Gemini is disabled (GEMINI_ENABLED=false)."
        return None, _gemini_client_error
    if not GEMINI_API_KEY:
        _gemini_client_error = "GEMINI_API_KEY is not set. Add it to floor-scan-svc/.env."
        return None, _gemini_client_error
    # Retry the whole client-construction dance a few times. If Avast
    # denies the initial cert-store read we sleep and try again — this is
    # the intermittent PermissionError we saw in production. On success we
    # cache the client and NEVER touch the cert store again (the httpx
    # client we build below uses an in-memory PEM bundle).
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            from google import genai
            from google.genai import types as _gtypes

            _httpx_client       = _build_gemini_httpx_client(async_=False)
            _httpx_async_client = _build_gemini_httpx_client(async_=True)

            # http_options.timeout is milliseconds. Without it, the underlying
            # httpx client has NO timeout and can hang forever on a stalled
            # socket — that starves the retry+fallback ladder because it never
            # returns an error to classify.
            #
            # We pass BOTH sync and async httpx clients so google-genai never
            # falls back to its default async client construction, which uses
            # `ssl.create_default_context()` and re-triggers Avast's Windows
            # cert-store interception on every request. Verified against
            # google-genai 2.20.0 source at _api_client.py:869-875 and 2314
            # — both fields are actively used by the SDK.
            _gemini_client = genai.Client(
                api_key=GEMINI_API_KEY,
                http_options=_gtypes.HttpOptions(
                    timeout=GEMINI_CALL_TIMEOUT_MS,
                    httpx_client=_httpx_client,
                    httpx_async_client=_httpx_async_client,
                ),
            )
            log.info(
                "Gemini client initialised (model=%s, per-call timeout=%d ms, "
                "ca_source=%s) on attempt %d.",
                GEMINI_MODEL, GEMINI_CALL_TIMEOUT_MS,
                _CA_SOURCE or "unknown", attempt,
            )
            return _gemini_client, ""
        except PermissionError as e:
            last_err = e
            log.warning(
                "Gemini client construction attempt %d hit PermissionError "
                "(likely Avast cert-store block): %s. Retrying in %.1fs ...",
                attempt, e, 0.75,
            )
            time.sleep(0.75)
        except Exception as e:
            # Any other error (bad API key, missing SDK, etc.) is not
            # transient — no point retrying.
            _gemini_client_error = f"Failed to construct Gemini client: {type(e).__name__}: {e}"
            log.error(_gemini_client_error)
            return None, _gemini_client_error

    # NOTE: intentionally DO NOT cache in `_gemini_client_error`. Avast's
    # aswMonFltProxy cert-store block is transient — we've documented above
    # that the correct advice is "try again". Caching the error here would
    # make the very next request short-circuit to the cached failure without
    # ever attempting init again, defeating that advice and permanently
    # bricking the endpoint until the process is restarted.
    transient_msg = (
        f"Failed to construct Gemini client after 3 attempts: "
        f"{type(last_err).__name__}: {last_err}. "
        "This looks like Avast's aswMonFltProxy blocking Python's access "
        "to the Windows certificate store. Try uploading again — the block "
        "is usually transient."
    )
    log.error(transient_msg)
    return None, transient_msg


# ---- Windows cert store snapshot + custom httpx client for Gemini --------
#
# Instead of relying on truststore's per-handshake lazy read of the Windows
# cert store (which Avast intermittently denies), we snapshot the store
# ONCE into an in-memory PEM bundle and pass it to httpx as a fully-loaded
# ssl.SSLContext. After the initial read the Gemini client makes zero
# further cert-store calls, so Avast's aswMonFltProxy driver has nothing
# to intercept during normal request traffic.

_ca_pem_cache: "str | None" = None
_CA_SOURCE: str = ""  # "windows-store" | "certifi" | "system-default"


def _load_windows_ca_pem(max_retries: int = 3) -> "str | None":
    """
    Enumerate the Windows ROOT + CA certificate stores and return a
    concatenated PEM bundle. Uses Python's stdlib `ssl.enum_certificates`
    (native Win32 CryptoAPI under the hood).

    Retries on PermissionError because Avast's filter driver is
    intermittent — the same call that fails once usually succeeds a
    fraction of a second later. Returns None on Non-Windows platforms,
    when the module is unavailable, or after `max_retries` failed reads.
    """
    if not hasattr(ssl, "enum_certificates"):
        return None
    last_err: Exception | None = None
    for i in range(1, max_retries + 1):
        try:
            pem_parts: List[str] = []
            for store_name in ("ROOT", "CA"):
                try:
                    for cert_der, encoding, trust in ssl.enum_certificates(store_name):
                        # `trust` is either True, False, or a set of OIDs the
                        # cert is trusted for. Include everything except
                        # explicit False (revoked / distrusted).
                        if trust is False:
                            continue
                        if encoding == "x509_asn":
                            pem_parts.append(ssl.DER_cert_to_PEM_cert(cert_der))
                except Exception as inner:
                    # A single store failing shouldn't kill the whole snapshot;
                    # keep whatever we already collected from the other store.
                    log.warning("Windows cert store %r read failed: %s: %s",
                                store_name, type(inner).__name__, inner)
            if pem_parts:
                bundle = "".join(pem_parts)
                log.info(
                    "Windows cert store snapshot: %d certs, %d bytes (attempt %d).",
                    len(pem_parts), len(bundle), i,
                )
                return bundle
        except PermissionError as e:
            last_err = e
            log.warning(
                "Windows cert store enumeration attempt %d denied "
                "(likely Avast aswMonFltProxy): %s. Retrying ...", i, e,
            )
            time.sleep(0.5)
        except Exception as e:
            last_err = e
            log.warning("Windows cert store enumeration attempt %d failed: %s: %s",
                        i, type(e).__name__, e)
            time.sleep(0.25)
    log.error("Windows cert store enumeration gave up after %d attempts. Last error: %s",
              max_retries, last_err)
    return None


def _get_ca_pem_bundle() -> "tuple[str | None, str]":
    """
    Return (pem_bundle, source_label). Caches on success so subsequent
    calls are free. Falls back to certifi's bundle if Windows read failed
    (retains verification but may miss Avast's MITM root, in which case
    the actual Gemini TLS handshake will fail with cert-verify — clear
    signal to add the Avast exception).
    """
    global _ca_pem_cache, _CA_SOURCE
    if _ca_pem_cache is not None:
        return _ca_pem_cache, _CA_SOURCE

    if os.name == "nt":
        bundle = _load_windows_ca_pem()
        if bundle:
            _ca_pem_cache = bundle
            _CA_SOURCE = "windows-store"
            return bundle, _CA_SOURCE

    # Fallback: certifi. Verification stays strict; may miss MITM roots.
    try:
        import certifi
        with open(certifi.where(), "r", encoding="utf-8") as f:
            bundle = f.read()
        _ca_pem_cache = bundle
        _CA_SOURCE = "certifi"
        log.info("Using certifi CA bundle as fallback (%d bytes).", len(bundle))
        return bundle, _CA_SOURCE
    except Exception as e:
        log.warning("certifi fallback unavailable: %s: %s", type(e).__name__, e)

    _CA_SOURCE = "system-default"
    return None, _CA_SOURCE


def _build_gemini_timeout():
    """
    Build an explicit httpx.Timeout with per-phase caps rather than a
    single value applied to everything. Rationale:

      connect: 5s   — Google's TCP is either up in <1s or broken.
                      Waiting 15s here would slow down "network down" detection
                      without materially improving success rate.
      read:    GEMINI_CALL_TIMEOUT_MS (default 15s) — this is the phase where
                      Gemini's model inference happens. Successful floor-plan
                      calls empirically finish in 4-12s; anything past 15s is
                      Google's server about to return 504 DEADLINE_EXCEEDED
                      anyway, so we cut off cleanly and fall through to the
                      secondary model instead.
      write:   10s  — image upload. Payloads are typically <500 KB PNG,
                      well under a second on any real link.
      pool:    5s   — single-connection client, pool contention shouldn't happen.

    Deliberately no "total request" cap in httpx (it doesn't have one);
    the sum of connect+write+read bounds real latency.
    """
    import httpx
    read_s = GEMINI_CALL_TIMEOUT_MS / 1000.0
    return httpx.Timeout(connect=5.0, read=read_s, write=10.0, pool=5.0)


def _build_gemini_httpx_client(async_: bool = False):
    """
    Construct the pre-built httpx.(Async)Client that google-genai will use
    for every Gemini API call. The SSL context is fully loaded from an
    in-memory PEM bundle so that AFTER this point, no cert-store reads
    happen at TLS handshake time.

    async_=False -> httpx.Client (sync, used by client.models.generate_content)
    async_=True  -> httpx.AsyncClient (used internally by google-genai for
                    its async paths and lifecycle management; without one,
                    the SDK spins up its own using the DEFAULT ssl context,
                    which re-triggers Avast's cert-store block on Windows).
    """
    import httpx
    ca_pem, source = _get_ca_pem_bundle()
    timeout = _build_gemini_timeout()
    if ca_pem is not None:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(cadata=ca_pem)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        kind = "async" if async_ else "sync"
        log.info("Gemini httpx %s client built with SSL context (source=%s, "
                 "connect=%.0fs read=%.0fs write=%.0fs pool=%.0fs).",
                 kind, source, timeout.connect, timeout.read, timeout.write, timeout.pool)
        if async_:
            return httpx.AsyncClient(verify=ctx, timeout=timeout)
        return httpx.Client(verify=ctx, timeout=timeout)
    # Absolute last resort: httpx default. Verification stays ON — Google's
    # cert will fail here if Avast is MITM-scanning without its root in a
    # trust store, which is the correct/loud failure mode.
    log.warning("Gemini httpx %s client falling back to default SSL context.",
                "async" if async_ else "sync")
    if async_:
        return httpx.AsyncClient(timeout=timeout)
    return httpx.Client(timeout=timeout)


# ---- Gemini call helper + error taxonomy ---------------------------------
#
# Extracted to module scope so the test suite can monkey-patch it without
# touching HTTP internals. The endpoint calls _gemini_generate(...) once per
# attempt; the endpoint itself owns the primary → fallback ladder.

# Live counter of request outcomes. Exposed via GET /gemini-stats so we can
# compute quota-vs-outage-vs-config error rates over time without pulling
# logs. Keys: "primary_ok", "fallback_ok", "primary_only_no_fallback",
# "both_failed:{primary_cat}:{fallback_cat}".
_gemini_outcomes: Counter = Counter()


# Structured-output schema handed to Gemini via GenerateContentConfig.
# Gemini is forced to produce JSON that validates against this schema — this
# eliminates the class of failures we saw where the model returned malformed
# mixed-syntax output like `"box_2d": ["ymin": 232, ...]` (a syntactic mash
# of array + object). No parser can recover from that; only the model-side
# schema constraint can prevent it. The schema mirrors what the prompt asks
# for so we don't need to change GEMINI_PROMPT.
GEMINI_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "objects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "class":      {"type": "string", "enum": ["chair", "table"]},
                    "box_2d":     {"type": "array",
                                   "items": {"type": "integer"},
                                   "minItems": 4, "maxItems": 4},
                    "shape":      {"type": "string", "enum": ["round", "rectangular"]},
                    "confidence": {"type": "number"},
                },
                "required": ["class", "box_2d", "shape", "confidence"],
                "propertyOrdering": ["class", "box_2d", "shape", "confidence"],
            },
        }
    },
    "required": ["objects"],
    "propertyOrdering": ["objects"],
}


def _gemini_generate(client, model_name: str, image_pil, prompt: str):
    """
    One Gemini vision request. Deterministic (temperature=0), JSON-only
    output enforced via response_schema (see GEMINI_RESPONSE_SCHEMA above),
    Automatic Function Calling disabled. Raises on error — the endpoint
    catches and classifies.
    """
    from google.genai import types
    return client.models.generate_content(
        model=model_name,
        contents=[types.Part.from_text(text=prompt), image_pil],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=GEMINI_RESPONSE_SCHEMA,
            temperature=0.0,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )


# ---------------------------------------------------------------------------
# Claude (Anthropic) provider — same contract as Gemini: build a client once,
# generate() returns an object whose `.text` attribute holds the model's JSON
# response and whose `.usage_metadata` mirrors Gemini's usage counters so the
# downstream logging / parsing code needs no branching.
# ---------------------------------------------------------------------------
_claude_client = None
_claude_client_error: str = ""


def _get_claude_client():
    """Init the Anthropic client once, cache. Returns (client, error_string)."""
    global _claude_client, _claude_client_error
    if not CLAUDE_ENABLED:
        return None, "Claude disabled (CLAUDE_ENABLED=false)"
    if _claude_client is not None:
        return _claude_client, ""
    if not CLAUDE_API_KEY:
        _claude_client_error = "CLAUDE_API_KEY environment variable is not set"
        return None, _claude_client_error
    try:
        from anthropic import Anthropic
        _claude_client = Anthropic(
            api_key=CLAUDE_API_KEY,
            timeout=CLAUDE_CALL_TIMEOUT_MS / 1000.0,
        )
        return _claude_client, ""
    except Exception as e:
        _claude_client_error = f"Failed to init Anthropic client: {type(e).__name__}: {e}"
        _claude_client = None
        return None, _claude_client_error


class _AiResponseShim:
    """Adapter that mirrors Gemini's response shape (`.text` + `.usage_metadata`)
    so the endpoint's parsing / logging code stays provider-agnostic."""
    __slots__ = ("text", "usage_metadata")

    def __init__(self, text: str, prompt_tokens, output_tokens, total_tokens):
        self.text = text
        self.usage_metadata = type("_Usage", (), {
            "prompt_token_count":     prompt_tokens,
            "candidates_token_count": output_tokens,
            "total_token_count":      total_tokens,
        })()


def _claude_generate(client, model_name: str, image_pil, prompt: str):
    """
    One Claude vision request. Same prompt as Gemini. Returns a shim with
    .text (the model's raw JSON) so the endpoint can parse identically.
    """
    import base64
    from io import BytesIO
    buf = BytesIO()
    image_pil.save(buf, format="PNG")
    b64_data = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
    response = client.messages.create(
        model=model_name,
        max_tokens=4096,
        temperature=0.0,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/png", "data": b64_data,
                }},
                {"type": "text", "text": prompt},
            ],
        }],
    )
    text_parts = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)
    usage = response.usage
    return _AiResponseShim(
        text="".join(text_parts),
        prompt_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        total_tokens=(
            (getattr(usage, "input_tokens", 0) or 0)
            + (getattr(usage, "output_tokens", 0) or 0)
        ),
    )


# ---------------------------------------------------------------------------
# OpenAI (ChatGPT) provider — mirrors Claude structure. Uses response_format
# json_object so the model is constrained to valid JSON just like Gemini.
# ---------------------------------------------------------------------------
_openai_client = None
_openai_client_error: str = ""


def _get_openai_client():
    """Init the OpenAI client once, cache. Returns (client, error_string)."""
    global _openai_client, _openai_client_error
    if not OPENAI_ENABLED:
        return None, "OpenAI disabled (OPENAI_ENABLED=false)"
    if _openai_client is not None:
        return _openai_client, ""
    if not OPENAI_API_KEY:
        _openai_client_error = "OPENAI_API_KEY environment variable is not set"
        return None, _openai_client_error
    try:
        from openai import OpenAI
        _openai_client = OpenAI(
            api_key=OPENAI_API_KEY,
            timeout=OPENAI_CALL_TIMEOUT_MS / 1000.0,
        )
        return _openai_client, ""
    except Exception as e:
        _openai_client_error = f"Failed to init OpenAI client: {type(e).__name__}: {e}"
        _openai_client = None
        return None, _openai_client_error


def _openai_generate(client, model_name: str, image_pil, prompt: str):
    """One OpenAI (GPT-4o-class) vision request. Returns a shim like Claude."""
    import base64
    from io import BytesIO
    buf = BytesIO()
    image_pil.save(buf, format="PNG")
    b64_data = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
    data_url = f"data:image/png;base64,{b64_data}"
    response = client.chat.completions.create(
        model=model_name,
        max_tokens=4096,
        temperature=0.0,
        response_format={"type": "json_object"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
    )
    text = (response.choices[0].message.content or "") if response.choices else ""
    usage = getattr(response, "usage", None)
    return _AiResponseShim(
        text=text,
        prompt_tokens=getattr(usage, "prompt_tokens", None) if usage else None,
        output_tokens=getattr(usage, "completion_tokens", None) if usage else None,
        total_tokens=getattr(usage, "total_tokens", None) if usage else None,
    )


# ---------------------------------------------------------------------------
# Provider dispatchers — the ONLY code paths the /scan-ai endpoint knows
# about. To add a fourth provider, add a branch in each of these functions.
# ---------------------------------------------------------------------------
def _get_ai_client():
    """Get the client for the currently-configured AI_PROVIDER."""
    if AI_PROVIDER == "claude":
        return _get_claude_client()
    if AI_PROVIDER == "openai":
        return _get_openai_client()
    return _get_gemini_client()


def _get_ai_models():
    """Return (primary, fallback) model names for the active provider."""
    if AI_PROVIDER == "claude":
        return CLAUDE_MODEL, CLAUDE_FALLBACK_MODEL
    if AI_PROVIDER == "openai":
        return OPENAI_MODEL, OPENAI_FALLBACK_MODEL
    return GEMINI_MODEL, GEMINI_FALLBACK_MODEL


def _get_ai_timeout_ms() -> int:
    """Per-call timeout, milliseconds, for the active provider."""
    if AI_PROVIDER == "claude":
        return CLAUDE_CALL_TIMEOUT_MS
    if AI_PROVIDER == "openai":
        return OPENAI_CALL_TIMEOUT_MS
    return GEMINI_CALL_TIMEOUT_MS


def _ai_generate(client, model_name: str, image_pil, prompt: str):
    """Dispatch a single generate call to the active provider."""
    if AI_PROVIDER == "claude":
        return _claude_generate(client, model_name, image_pil, prompt)
    if AI_PROVIDER == "openai":
        return _openai_generate(client, model_name, image_pil, prompt)
    return _gemini_generate(client, model_name, image_pil, prompt)


def _is_ai_hard_quota_error(err: BaseException) -> bool:
    """Provider-aware hard-quota detection (see per-provider docstrings)."""
    if AI_PROVIDER == "claude":
        return _is_hard_quota_error_claude(err)
    if AI_PROVIDER == "openai":
        return _is_hard_quota_error_openai(err)
    return _is_hard_quota_error(err)


def _err_status(err: BaseException) -> int:
    """
    HTTP status code from a provider error. Works for:
      - google-genai (uses .code)
      - anthropic (uses .status_code)
      - openai (uses .status_code)
    Returns 0 when the error never got a real HTTP response (timeout etc).
    """
    for attr in ("status_code", "code"):
        v = getattr(err, attr, None)
        if v is None:
            continue
        try:
            return int(v)
        except (TypeError, ValueError):
            continue
    return 0


def _err_category(status: int) -> str:
    """Broad category label used for logging + outcome-counter keys."""
    if status == 0:      return "timeout"
    if status == 429:    return "quota"
    if status == 400:    return "bad_request"
    if status in (401, 403): return "auth"
    if status == 404:    return "model_not_found"
    if status in (500, 502, 503, 504): return "upstream_5xx"
    return f"other_{status}"


def _is_hard_quota_error(err: BaseException) -> bool:
    """
    Decide whether a 429 error is HARD quota exhaustion (daily / free-tier
    / billing cap) vs a transient per-minute rate limit.

    Retrying the SAME model within the same request is pointless for hard
    quota — the quota window won't roll over in the milliseconds between
    our retry attempts. Skipping the primary retry saves the wasted ~700 ms
    per attempt and gets us to the fallback sooner.

    Evidence markers (from live Google response — see PR discussion):
      - google.rpc.QuotaFailure with quotaId containing "PerDay" or
        "FreeTier" → hard cap
      - Message includes "plan and billing" or "billing details" →
        billing-tier / free-tier exhaustion
    """
    if _err_status(err) != 429:
        return False

    def _hit(text: str) -> bool:
        t = (text or "").lower()
        return "plan and billing" in t or "billing details" in t

    body = getattr(err, "details", None)
    if isinstance(body, dict):
        inner = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
        for d in inner.get("details", []) or []:
            if not isinstance(d, dict):
                continue
            if str(d.get("@type", "")).endswith("QuotaFailure"):
                for v in d.get("violations", []) or []:
                    qid = str(v.get("quotaId", ""))
                    if "PerDay" in qid or "FreeTier" in qid:
                        return True
        if _hit(inner.get("message", "")):
            return True

    return _hit(str(getattr(err, "message", "")))


def _is_hard_quota_error_claude(err: BaseException) -> bool:
    """
    Anthropic 429 = rate limit. Distinguishes per-minute throttle (retryable
    on the same model) from monthly-billing / credit-cap exhaustion (hard —
    retrying the primary model in the same request is pointless).

    Anthropic embeds the trigger in the error message or the response body.
    We match a small set of markers.
    """
    if _err_status(err) != 429:
        return False
    msg = str(err).lower()
    for marker in ("monthly", "spend limit", "credit", "billing", "quota exceeded"):
        if marker in msg:
            return True
    return False


def _is_hard_quota_error_openai(err: BaseException) -> bool:
    """
    OpenAI 429 with error.code = 'insufficient_quota' or a 'billing_hard_limit'
    marker means the account or organization spend cap is exhausted. Same
    treatment as Gemini's PerDay/FreeTier: don't retry the primary model.
    """
    if _err_status(err) != 429:
        return False
    msg = str(err).lower()
    for marker in ("insufficient_quota", "billing_hard_limit", "monthly", "credit", "quota exceeded"):
        if marker in msg:
            return True
    body = getattr(err, "body", None)
    if isinstance(body, dict):
        err_obj = body.get("error", {}) if isinstance(body.get("error"), dict) else {}
        code = str(err_obj.get("code", "")).lower()
        if code in ("insufficient_quota", "billing_hard_limit"):
            return True
    return False


def _log_ladder(**kv: Any) -> None:
    """
    Emit a single GEMINI_LADDER line with the requested structured fields.
    Values pass through str() so None/int/float all serialise cleanly.
    """
    parts = " ".join(f"{k}={v}" for k, v in kv.items())
    log.info("GEMINI_LADDER %s", parts)


# Errors that should trigger a fallback to the secondary model. Covers
# 0 (client-side timeout / connect fail — no HTTP response arrived),
# 404 (primary model not available on this key), 429 (rate limit),
# and 5xx (upstream server errors / deadline exceeded).
_FALLBACK_STATUS_CODES = frozenset({0, 404, 429, 500, 502, 503, 504})


def _resolve_final_error(primary_status: int, fallback_status: Optional[int]) -> Tuple[str, int, bool, str]:
    """
    Given the final HTTP statuses of the primary + fallback attempts,
    decide the user-visible (error_code, http_status, retryable, message).

    fallback_status is None if the fallback was not attempted (e.g. primary
    returned a non-fallback-eligible error such as 400 / 403).

    Priority order (most specific first):
      auth  > bad_request > quota > everything else (temporary unavailability)
    """
    statuses = {primary_status, fallback_status} - {None}

    if 401 in statuses or 403 in statuses:
        return (
            "GEMINI_CONFIG_ERROR", 503, False,
            "Gemini API rejected the request due to authentication or "
            "authorisation. Check that GEMINI_API_KEY is valid and has "
            "access to the configured model.",
        )
    if statuses == {400}:
        return (
            "INVALID_IMAGE", 400, False,
            "Gemini rejected the uploaded image (bad format or unsupported "
            "content). Try a different image.",
        )
    if statuses == {429}:
        return (
            "GEMINI_QUOTA_EXHAUSTED", 429, True,
            "Gemini API quota is exhausted on both configured models. "
            "Retry after the quota window resets, or upgrade the billing "
            "tier for this API key.",
        )
    # Everything else — timeouts, 5xx, DEADLINE_EXCEEDED, model_not_found
    # on primary followed by 5xx on fallback, etc. — is a transient
    # service issue that the caller should retry.
    return (
        "GEMINI_UNAVAILABLE", 503, True,
        "Gemini detection service is temporarily unavailable. "
        "Please try again in a moment.",
    )


# ----------------------------------------------------------------------
# Response shape
# ----------------------------------------------------------------------

class Chair(BaseModel):
    x: int          # top-left x of bounding box, image pixels
    y: int          # top-left y
    w: int
    h: int
    conf: float     # 0..1 confidence proxy (size + squareness)

class TableRound(BaseModel):
    cx: int         # centre x
    cy: int         # centre y
    r: int          # radius in pixels
    conf: float     # circularity 0..1

class TableRect(BaseModel):
    x: int
    y: int
    w: int
    h: int
    conf: float     # rect-fill 0..1

class ScanResponse(BaseModel):
    image_width:  int
    image_height: int
    chairs:       List[Chair]
    tables_round: List[TableRound]
    tables_rect:  List[TableRect]
    thresholds:   Dict[str, float]   # echo back for debugging


# ----------------------------------------------------------------------
# Detection helpers
# ----------------------------------------------------------------------

def _is_line_drawing(img_bgr: np.ndarray, colour_pixel_threshold: float = 0.30) -> bool:
    """
    Rough heuristic: is the image a black-on-white line drawing (architectural
    floor plan) vs a colour photograph?

    A line drawing is mostly near-white background with thin black strokes and
    very few coloured pixels. A photograph has broad regions of colour and
    varied brightness.

    Method: convert to grayscale, count how many pixels are neither very light
    (>= 235) nor very dark (<= 20). If that "midtone" fraction is small
    (< colour_pixel_threshold), it's likely a line drawing.

    Cheap enough to run on every scan (~5 ms on typical floor-plan sizes).
    """
    if img_bgr is None or img_bgr.size == 0:
        return False
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    total = gray.size
    if total == 0:
        return False
    midtone = int(np.count_nonzero((gray > 20) & (gray < 235)))
    midtone_ratio = midtone / total
    return midtone_ratio < colour_pixel_threshold


def _is_round_shape(img_bgr: np.ndarray, x1: float, y1: float,
                    x2: float, y2: float, threshold: float = 0.85) -> bool:
    """
    Decide whether the pixels INSIDE a YOLO bounding box form a round shape.

    Rationale: YOLO returns a bounding box (rectangle) for every detection,
    but a rectangular table drawn as a square still has a square-ish bbox.
    Aspect-ratio alone can't distinguish "round table" from "square-shaped
    rectangular table". So we look at the ACTUAL pixels inside the bbox and
    measure how circle-like the largest contour is.

    Metric: circularity = 4 * pi * area / perimeter^2
        Perfect circle   ~ 1.00
        Filled square    ~ 0.785
        Filled rectangle ~ 0.6-0.8
        Long ellipse     ~ 0.4-0.6

    Returns True if circularity >= threshold (default 0.85, comfortably
    above a square). False if the crop is empty, has no contour, or the
    contour is elongated / rectangular.
    """
    xi1, yi1, xi2, yi2 = int(x1), int(y1), int(x2), int(y2)
    crop = img_bgr[max(0, yi1):yi2, max(0, xi1):xi2]
    if crop.size == 0:
        return False

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # Otsu picks the threshold automatically. THRESH_BINARY_INV so the object
    # ends up WHITE on a black background — findContours expects that.
    _, thresh = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return False

    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)
    perimeter = cv2.arcLength(largest, True)
    if perimeter <= 0 or area < 10:
        return False

    circularity = 4.0 * math.pi * area / (perimeter * perimeter)
    return circularity >= threshold


def _iou_xywh(a, b) -> float:
    """IoU of two bounding boxes given as (x, y, w, h)."""
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    inter_x1 = max(a[0], b[0])
    inter_y1 = max(a[1], b[1])
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    iw = max(0, inter_x2 - inter_x1)
    ih = max(0, inter_y2 - inter_y1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    a_area = a[2] * a[3]
    b_area = b[2] * b[3]
    return inter / float(a_area + b_area - inter)

def _dedupe_boxes(items: List[Dict[str, Any]], iou_thresh: float) -> List[Dict[str, Any]]:
    """Greedy NMS-style dedupe — keep highest-confidence box, drop overlapping."""
    items_sorted = sorted(items, key=lambda d: -d.get("conf", 0))
    kept: List[Dict[str, Any]] = []
    for it in items_sorted:
        box = (it["x"], it["y"], it["w"], it["h"])
        clash = any(_iou_xywh(box, (k["x"], k["y"], k["w"], k["h"])) > iou_thresh for k in kept)
        if not clash:
            kept.append(it)
    return kept

def _detect(img_bgr: np.ndarray):
    """
    Run the full detection pipeline on a BGR image.
    Returns (chairs, tables_round, tables_rect) as lists of dicts ready to
    serialise.
    """
    h_img, w_img = img_bgr.shape[:2]

    # 1. Grayscale
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # 1b. Template-matching pass (runs first so its matches win in dedupe).
    # If templates/ is empty this returns empty lists silently and the
    # contour-based detector below carries the whole load.
    tpl_hits = match_all_templates(gray)
    tpl_chairs       = tpl_hits.get("chairs",       []) or []
    tpl_tables_round = tpl_hits.get("tables_round", []) or []
    tpl_tables_rect  = tpl_hits.get("tables_rect",  []) or []

    # 2. Adaptive threshold so we don't fail on uneven lighting / scanned plans
    bin_img = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15, C=8,
    )

    # 3. Morphological close — heal 1-2 px gaps in line drawings so a chair
    # outlined as 4 short segments still becomes one closed contour.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.morphologyEx(bin_img, cv2.MORPH_CLOSE, kernel, iterations=1)

    # 4. Find external contours
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    chairs:       List[Dict[str, Any]] = []
    tables_round: List[Dict[str, Any]] = []
    tables_rect:  List[Dict[str, Any]] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < CHAIR_MIN_PX_AREA:
            continue        # noise dot, dimension marker, etc.

        x, y, w, h = cv2.boundingRect(cnt)
        if w == 0 or h == 0:
            continue
        bbox_area = w * h
        if bbox_area == 0:
            continue
        rect_fill = area / float(bbox_area)
        aspect = w / float(h)
        perim = cv2.arcLength(cnt, True)
        circularity = (4 * np.pi * area / (perim * perim)) if perim > 0 else 0.0

        # --- Chair ---
        # Small + roughly square. Square-ish chairs are common in floor plans;
        # wide rectangular shapes that are chair-sized are usually dimension labels.
        if (CHAIR_MIN_PX_AREA <= area <= CHAIR_MAX_PX_AREA) and (0.6 <= aspect <= 1.4):
            # Confidence proxy: prefer items closer to chair_mid + perfectly square
            mid = (CHAIR_MIN_PX_AREA + CHAIR_MAX_PX_AREA) / 2.0
            size_score = 1.0 - abs(area - mid) / max(mid - CHAIR_MIN_PX_AREA, 1.0)
            square_score = 1.0 - abs(1.0 - aspect)
            conf = max(0.0, min(1.0, 0.5 * size_score + 0.5 * square_score))
            chairs.append({
                "x": int(x), "y": int(y), "w": int(w), "h": int(h),
                "conf": round(conf, 3),
            })
            continue

        # --- Round table ---
        if (TABLE_MIN_PX_AREA <= area <= TABLE_MAX_PX_AREA) and circularity >= CIRCULARITY_THRESHOLD:
            (cx_f, cy_f), r_f = cv2.minEnclosingCircle(cnt)
            tables_round.append({
                "cx": int(cx_f), "cy": int(cy_f), "r": int(r_f),
                # Also keep a bounding box so dedupe IoU works uniformly.
                "x": int(cx_f - r_f), "y": int(cy_f - r_f),
                "w": int(2 * r_f), "h": int(2 * r_f),
                "conf": round(min(1.0, circularity), 3),
            })
            continue

        # --- Rect table ---
        if (TABLE_MIN_PX_AREA <= area <= TABLE_MAX_PX_AREA) and rect_fill >= RECT_FILL_THRESHOLD:
            # Restrict to plausible table proportions; avoid catching rooms.
            # Long, very narrow rectangles aren't furniture.
            if 1.2 <= max(aspect, 1 / aspect) <= 4.0:
                tables_rect.append({
                    "x": int(x), "y": int(y), "w": int(w), "h": int(h),
                    "conf": round(min(1.0, rect_fill), 3),
                })
                continue

    # 5. Merge template-matched hits into each category, with templates
    # going first so they win in dedupe (sorted by conf, template matches
    # are typically > contour matches once the user supplies good templates).
    # For round tables, we need to add cx/cy/r fields so the existing
    # output schema matches; we derive them from the bbox.
    for t in tpl_tables_round:
        cx = t["x"] + t["w"] // 2
        cy = t["y"] + t["h"] // 2
        r  = min(t["w"], t["h"]) // 2
        tables_round.append({**t, "cx": cx, "cy": cy, "r": r})
    chairs       = tpl_chairs + chairs
    tables_rect  = tpl_tables_rect + tables_rect

    # 6. Dedupe each category independently
    chairs       = _dedupe_boxes(chairs,       DEDUPE_IOU)
    tables_round = [t for t in _dedupe_boxes(tables_round, DEDUPE_IOU)]
    tables_rect  = _dedupe_boxes(tables_rect,  DEDUPE_IOU)

    # Strip the bbox helper fields we tacked onto round tables for dedupe.
    tables_round_clean = [
        {"cx": t["cx"], "cy": t["cy"], "r": t["r"], "conf": t["conf"]}
        for t in tables_round
    ]

    return chairs, tables_round_clean, tables_rect, w_img, h_img


# ----------------------------------------------------------------------
# FastAPI app
# ----------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Startup / shutdown hook. Loads heavy models exactly ONCE per Python
    process. In uvicorn --reload mode this only runs in the worker child,
    not the reloader parent — which is what stops the log line
    "Loading YOLO model" from appearing twice on startup.
    """
    _load_yolo()
    _load_architect()
    yield
    # (no explicit teardown — process exit reclaims all model memory)


app = FastAPI(title="Facility floor-plan scanner", version="1.0.0", lifespan=lifespan)

# CORS — service is intended to sit behind the Node backend (bind to
# 127.0.0.1 in prod so the browser can't reach it directly). The env var
# ALLOWED_ORIGINS lets you open it up if you ever want the browser to hit
# /scan directly. Comma-separated list, or "*" to allow all (dev default).
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
if _origins_env == "*" or _origins_env == "":
    _allowed_origins = ["*"]
else:
    _allowed_origins = [s.strip() for s in _origins_env.split(",") if s.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "floor-scan",
        "templates": {
            # Live count -- forces a cache refresh so newly dropped templates
            # show up here without restarting the service.
            "loaded": template_count(),
            "match_threshold": TEMPLATE_MATCH_THRESHOLD,
            "scales": TEMPLATE_SCALES,
        },
        "thresholds": {
            "chair_min": CHAIR_MIN_PX_AREA, "chair_max": CHAIR_MAX_PX_AREA,
            "table_min": TABLE_MIN_PX_AREA, "table_max": TABLE_MAX_PX_AREA,
            "circularity": CIRCULARITY_THRESHOLD,
            "rect_fill": RECT_FILL_THRESHOLD,
            "dedupe_iou": DEDUPE_IOU,
        },
        "yolo": {
            "model": YOLO_MODEL_NAME,
            "conf_threshold": YOLO_CONF_THRESHOLD,
            "loaded": _yolo is not None,
            "classes_known": len(_yolo.names) if _yolo is not None else 0,
        },
        "architect": {
            "enabled": ARCHITECT_ENABLED,
            "loaded": _architect is not None,
            "model": f"{ARCHITECT_REPO}/{ARCHITECT_FILE}" if _architect is not None else None,
            "conf_threshold": ARCHITECT_CONF,
            "classes_known": len(_architect_names),
            "chair_class_id": ARCHITECT_CHAIR_ID,
            "table_class_id": ARCHITECT_TABLE_ID,
        },
        "gemini": {
            "enabled": GEMINI_ENABLED,
            "model": GEMINI_MODEL,
            "fallback_model": GEMINI_FALLBACK_MODEL or None,
            "call_timeout_ms": GEMINI_CALL_TIMEOUT_MS,
            "max_ladder_retries": GEMINI_MAX_LADDER_RETRIES,
            "retry_base_s": GEMINI_RETRY_BASE_S,
            "retry_max_s": GEMINI_RETRY_MAX_S,
            "response_schema_enforced": True,
            # Don't leak the key. Just say whether one is configured.
            "api_key_present": bool(GEMINI_API_KEY),
            "client_initialised": _gemini_client is not None,
            "last_error": _gemini_client_error or None,
        },
    }


@app.get("/gemini-stats")
def gemini_stats():
    """
    Live outcome counter for /scan-gemini. In-memory, per-process, resets
    on service restart — enough to answer "what's the current failure
    profile" without pulling logs. Keys of interest:

      primary_ok             — first attempt succeeded
      fallback_ok            — primary failed, fallback rescued the request
      both_failed:X:Y        — primary category X + fallback category Y both failed
      result:OK              — total successful requests
      result:GEMINI_UNAVAILABLE / GEMINI_QUOTA_EXHAUSTED / GEMINI_CONFIG_ERROR /
        INVALID_IMAGE        — count per final user-visible error_code
    """
    total = sum(v for k, v in _gemini_outcomes.items() if k.startswith("result:"))
    return {
        "total_requests": total,
        "outcomes": dict(_gemini_outcomes),
    }


@app.post("/scan", response_model=ScanResponse)
async def scan(image: UploadFile = File(...)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image")

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_UPLOAD_BYTES} bytes)")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    chairs, tables_round, tables_rect, w_img, h_img = _detect(img_bgr)

    log.info(
        "scan: %dx%d  chairs=%d  tables_round=%d  tables_rect=%d",
        w_img, h_img, len(chairs), len(tables_round), len(tables_rect),
    )

    return ScanResponse(
        image_width=w_img,
        image_height=h_img,
        chairs=chairs,
        tables_round=tables_round,
        tables_rect=tables_rect,
        thresholds={
            "chair_min": CHAIR_MIN_PX_AREA, "chair_max": CHAIR_MAX_PX_AREA,
            "table_min": TABLE_MIN_PX_AREA, "table_max": TABLE_MAX_PX_AREA,
            "circularity": CIRCULARITY_THRESHOLD,
            "rect_fill": RECT_FILL_THRESHOLD,
            "dedupe_iou": DEDUPE_IOU,
        },
    )


@app.post("/scan-yolo", response_model=ScanResponse)
async def scan_yolo(image: UploadFile = File(...)):
    """
    YOLOv11 pretrained COCO detection.

    Returns the SAME JSON shape as /scan (chairs / tables_round / tables_rect)
    so the Node backend and frontend need zero changes to consume it.

    COCO doesn't distinguish round vs rectangular tables, so we use an
    aspect-ratio heuristic to split dining-table detections into the two
    buckets the frontend expects.
    """
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image")

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_UPLOAD_BYTES} bytes)")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    h_img, w_img = img_bgr.shape[:2]

    # Run YOLO inference. `verbose=False` silences the per-call progress bar
    # so the service logs stay clean. `classes=[...]` restricts detection at
    # the source to just chair + dining table — faster than filtering later,
    # and impossible to accidentally return an object type the frontend
    # doesn't support (couch, tv, person, etc.).
    results = _yolo(
        img_bgr,
        verbose=False,
        conf=YOLO_CONF_THRESHOLD,
        classes=[COCO_CHAIR, COCO_DINING_TABLE],
    )[0]

    chairs: List[Dict[str, Any]] = []
    tables_round: List[Dict[str, Any]] = []
    tables_rect: List[Dict[str, Any]] = []

    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        w = x2 - x1
        h = y2 - y1

        if cls == COCO_CHAIR:
            chairs.append({
                "x": int(x1), "y": int(y1),
                "w": int(w), "h": int(h),
                "conf": round(conf, 3),
            })
        elif cls == COCO_DINING_TABLE:
            # Pixel-based shape analysis — look at the actual object shape
            # INSIDE YOLO's bounding box and measure how circle-like it is.
            # Much more accurate than the previous bbox-aspect-ratio rule:
            # a SQUARE-shaped rectangular table has a square bbox but its
            # INSIDE shape isn't circular, so the aspect rule got that wrong.
            # See _is_round_shape() for the circularity math.
            if _is_round_shape(img_bgr, x1, y1, x2, y2, threshold=0.85):
                cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                r = min(w, h) / 2.0
                tables_round.append({
                    "cx": int(cx), "cy": int(cy),
                    "r": int(r), "conf": round(conf, 3),
                })
            else:
                tables_rect.append({
                    "x": int(x1), "y": int(y1),
                    "w": int(w), "h": int(h),
                    "conf": round(conf, 3),
                })

    # ------------------------------------------------------------------
    # PHASE 1 BRIDGE — TEMPORARY OpenCV fallback
    # ------------------------------------------------------------------
    # YOLOv11 pretrained was trained on COCO photos. It excels on real-world
    # photos of chairs / tables but is fundamentally blind to stylized
    # architectural icons (U-shape chairs, circle tables drawn as thin
    # outlines). When YOLO returns zero detections we fall back to the older
    # OpenCV template-matching path (`_detect`), which uses the icons the
    # admin already dropped into `templates/{chairs,tables_rect,tables_round}/`
    # and handles line drawings well.
    #
    # This fallback is INTENDED TO BE REMOVED IN PHASE 2 once the fine-tuned
    # YOLO model is trained on labeled floor plans. At that point the
    # architecture becomes: fine-tuned YOLO (primary) → pretrained YOLO
    # (fallback) — no OpenCV, per the agreed target design.
    # ------------------------------------------------------------------
    used_fallback = False
    if not chairs and not tables_round and not tables_rect:
        # Only fall back to OpenCV template matching if the image LOOKS like a
        # line drawing. Colour photos produce massive false-positive counts
        # (100+ chairs) because template matching pattern-matches on wood
        # grain / leather / shadows. Test: percentage of "colourful" pixels.
        looks_like_line_drawing = _is_line_drawing(img_bgr)

        if looks_like_line_drawing:
            log.info(
                "scan-yolo: %dx%d  YOLO produced 0 detections; image looks like a line drawing, falling back to OpenCV templates",
                w_img, h_img,
            )
            fb_chairs, fb_round, fb_rect, *_ = _detect(img_bgr)
            # Sanity cap — if OpenCV returns a suspicious quantity of chairs
            # (way more than a real room would ever have), treat as noise.
            if len(fb_chairs) > OPENCV_FALLBACK_MAX_CHAIRS:
                log.warning(
                    "scan-yolo: OpenCV fallback returned %d chairs (>%d cap); discarding as likely false positives",
                    len(fb_chairs), OPENCV_FALLBACK_MAX_CHAIRS,
                )
            else:
                chairs, tables_round, tables_rect = fb_chairs, fb_round, fb_rect
                used_fallback = True
                log.info(
                    "scan-yolo: OpenCV fallback  chairs=%d  tables_round=%d  tables_rect=%d",
                    len(chairs), len(tables_round), len(tables_rect),
                )
        else:
            log.info(
                "scan-yolo: %dx%d  YOLO produced 0 detections; image looks like a photo (not a line drawing), skipping OpenCV fallback to avoid false positives",
                w_img, h_img,
            )
    else:
        log.info(
            "scan-yolo: %dx%d  chairs=%d  tables_round=%d  tables_rect=%d",
            w_img, h_img, len(chairs), len(tables_round), len(tables_rect),
        )

    return ScanResponse(
        image_width=w_img,
        image_height=h_img,
        chairs=chairs,
        tables_round=tables_round,
        tables_rect=tables_rect,
        thresholds={
            # ScanResponse.thresholds is typed Dict[str, float] — only
            # numeric fields go here. The model NAME is exposed via /health.
            "conf_threshold": YOLO_CONF_THRESHOLD,
            "round_circularity_threshold": 0.85,
            # 1.0 = YOLO produced the results; 2.0 = OpenCV fallback fired.
            # Useful when debugging why counts vary between images.
            "detection_method": 2.0 if used_fallback else 1.0,
        },
    )


@app.post("/scan-architect", response_model=ScanResponse)
async def scan_architect(image: UploadFile = File(...)):
    """
    EXPERIMENTAL — SamirShabani/Architect (YOLOv8m fine-tuned on FloorPlanCAD).

    Purpose: A/B comparison against /scan-yolo on real architectural floor-plan
    drawings. Same JSON response shape so the Node backend can point at either
    endpoint by changing one URL.

    Class mapping (verified from the model's own README):
      class 13 = "chair"   -> chairs bucket
      class 14 = "table"   -> tables_round OR tables_rect
                              (Architect uses a single generic 'table' class,
                               so we run the detected bbox through the existing
                               _is_round_shape() pixel-based circularity check
                               to split it into round vs rect — same logic
                               used for COCO's dining-table class in /scan-yolo)

    All other 26 Architect classes (doors, windows, cabinets, beds, etc.) are
    filtered at the source via classes=[...] — they are not part of the current
    POC scope (chair / round_table / rectangular_table only).

    Returns 503 if the Architect model failed to load at startup.

    LICENSE NOTE: This model is CC BY-NC 4.0 (NonCommercial). Fine for POC /
    internal demo. NOT permitted for commercial SaaS deployment without
    author permission or a compatible-licensed replacement.
    """
    if _architect is None:
        raise HTTPException(
            status_code=503,
            detail="Architect model is not loaded. Check startup logs and ARCHITECT_ENABLED env var.",
        )
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image")

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_UPLOAD_BYTES} bytes)")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    h_img, w_img = img_bgr.shape[:2]

    # Resolve chair/table class IDs defensively. If the model's class order
    # matches the README (13=chair, 14=table) we use the constants. Otherwise
    # we look them up by name — so a future model re-release with a different
    # index ordering still works.
    chair_id = ARCHITECT_CHAIR_ID if _architect_names.get(ARCHITECT_CHAIR_ID) == "chair" else next(
        (cid for cid, nm in _architect_names.items() if nm == "chair"), None
    )
    table_id = ARCHITECT_TABLE_ID if _architect_names.get(ARCHITECT_TABLE_ID) == "table" else next(
        (cid for cid, nm in _architect_names.items() if nm == "table"), None
    )
    if chair_id is None or table_id is None:
        raise HTTPException(
            status_code=500,
            detail=f"Architect model does not expose chair/table classes as expected. "
                   f"chair_id={chair_id} table_id={table_id} names={_architect_names}",
        )

    # Run Architect. classes=[chair_id, table_id] restricts detection to the
    # two categories we care about — the other 26 classes (doors, windows,
    # etc.) are dropped at the source, matching the pattern used in /scan-yolo.
    results = _architect(
        img_bgr,
        verbose=False,
        conf=ARCHITECT_CONF,
        classes=[chair_id, table_id],
    )[0]

    chairs: List[Dict[str, Any]] = []
    tables_round: List[Dict[str, Any]] = []
    tables_rect: List[Dict[str, Any]] = []

    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        w = x2 - x1
        h = y2 - y1

        if cls == chair_id:
            chairs.append({
                "x": int(x1), "y": int(y1),
                "w": int(w), "h": int(h),
                "conf": round(conf, 3),
            })
        elif cls == table_id:
            # Same shape-split logic used for COCO dining tables in /scan-yolo.
            # Architect emits a single 'table' class; we look at the pixels
            # inside the bbox and measure circularity to decide round vs rect.
            if _is_round_shape(img_bgr, x1, y1, x2, y2, threshold=0.85):
                cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                r = min(w, h) / 2.0
                tables_round.append({
                    "cx": int(cx), "cy": int(cy),
                    "r": int(r), "conf": round(conf, 3),
                })
            else:
                tables_rect.append({
                    "x": int(x1), "y": int(y1),
                    "w": int(w), "h": int(h),
                    "conf": round(conf, 3),
                })

    log.info(
        "scan-architect: %dx%d  chairs=%d  tables_round=%d  tables_rect=%d",
        w_img, h_img, len(chairs), len(tables_round), len(tables_rect),
    )

    return ScanResponse(
        image_width=w_img,
        image_height=h_img,
        chairs=chairs,
        tables_round=tables_round,
        tables_rect=tables_rect,
        thresholds={
            "conf_threshold": ARCHITECT_CONF,
            "round_circularity_threshold": 0.85,
            # 3.0 = Architect model handled the scan. Distinguishes this endpoint
            # from /scan-yolo (1.0 YOLO / 2.0 OpenCV fallback) in the same field.
            "detection_method": 3.0,
        },
    )


def _gemini_box_to_pixels(box_2d, img_w: int, img_h: int):
    """
    Convert Gemini's [ymin, xmin, ymax, xmax] normalized 0..1000 into
    pixel coordinates (x1, y1, x2, y2). Returns None if the box is
    malformed or degenerate.
    """
    if not isinstance(box_2d, (list, tuple)) or len(box_2d) != 4:
        return None
    if not all(isinstance(v, (int, float)) for v in box_2d):
        return None
    y1n, x1n, y2n, x2n = box_2d
    # Clip in case the model overshoots the 0..1000 range slightly.
    y1n = max(0.0, min(1000.0, float(y1n)))
    x1n = max(0.0, min(1000.0, float(x1n)))
    y2n = max(0.0, min(1000.0, float(y2n)))
    x2n = max(0.0, min(1000.0, float(x2n)))
    x1 = int(round(x1n / 1000.0 * img_w))
    y1 = int(round(y1n / 1000.0 * img_h))
    x2 = int(round(x2n / 1000.0 * img_w))
    y2 = int(round(y2n / 1000.0 * img_h))
    if x2 <= x1 or y2 <= y1:
        return None
    return (x1, y1, x2, y2)


@app.post("/scan-ai", response_model=ScanResponse)
async def scan_ai(image: UploadFile = File(...)):
    """
    Pluggable AI vision scan. The provider is chosen by the AI_PROVIDER env
    variable — one of "gemini" (default), "claude", or "openai". The same
    prompt, JSON schema, retry ladder, hard-quota short-circuit, and response
    parsing are reused across all three; only the SDK call is dispatched.

    Sends the uploaded image to the configured provider with a strict "one
    bbox per chair / per table" JSON prompt, converts the returned box
    coordinates into pixel space, and maps them onto the ScanResponse schema
    so the Node backend / frontend need zero changes.

    Response conventions:
      - class="chair"  -> chairs bucket (rectangular bbox)
      - class="table" + shape="round"        -> tables_round (cx, cy, r)
      - class="table" + shape="rectangular"  -> tables_rect  (bbox)
      - detection_method = 4.0 (AI vision model handled the scan)

    Returns 503 if the configured provider's API key is missing, its SDK is
    unavailable, or client construction fails.

    LICENSE / COST NOTE: Every call is a paid vendor API request. Do not
    route production traffic here without rate limits and per-tenant billing.
    """
    primary_model, fallback_model = _get_ai_models()
    call_timeout_ms = _get_ai_timeout_ms()

    client, err = _get_ai_client()
    if client is None:
        raise HTTPException(status_code=503, detail={
            "error_code": "AI_CONFIG_ERROR",
            "message": f"AI provider '{AI_PROVIDER}' could not initialise: {err}. "
                       f"Check the corresponding API key env var and startup logs.",
            "retryable": False,
        })

    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail={
            "error_code": "INVALID_IMAGE",
            "message": "Upload must be an image (multipart form-data).",
            "retryable": False,
        })

    raw = await image.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail={
            "error_code": "INVALID_IMAGE",
            "message": "Empty upload.",
            "retryable": False,
        })
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail={
            "error_code": "INVALID_IMAGE",
            "message": f"Image too large (max {MAX_UPLOAD_BYTES} bytes).",
            "retryable": False,
        })

    arr = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail={
            "error_code": "INVALID_IMAGE",
            "message": "Could not decode image (corrupt or unsupported format).",
            "retryable": False,
        })

    h_img, w_img = img_bgr.shape[:2]

    try:
        from PIL import Image
    except Exception as e:
        log.error("scan-ai: PIL not available: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=503, detail={
            "error_code": "AI_CONFIG_ERROR",
            "message": "Server is missing PIL/Pillow. Contact administrator.",
            "retryable": False,
        })

    img_pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))

    # ------------------------------------------------------------------
    # Primary → fallback ladder, wrapped in a BOUNDED retry envelope for
    # transient upstream failures (see GEMINI_MAX_LADDER_RETRIES).
    #
    # For each retry attempt: run the primary → fallback ladder once. If it
    # succeeds, return. If both models fail with retryable-only errors,
    # sleep with exponential backoff + jitter and try again. If any error
    # is non-retryable (400/401/403), break out immediately.
    #
    # HARD-QUOTA SHORT-CIRCUIT: if the primary returns a 429 that
    # `_is_hard_quota_error()` identifies as hard quota (PerDay / free-tier
    # / billing markers), we mark it dead-for-this-request and SKIP the
    # primary call on all subsequent ladder retries — retry the fallback
    # only. Avoids the ~700 ms per-retry waste of hitting a wall we know
    # won't move within our millisecond-scale retry window.
    # ------------------------------------------------------------------
    import random as _random
    request_id = uuid.uuid4().hex[:8]
    resp = None
    model_used = primary_model
    primary_status: int = 200
    primary_ms: int = 0
    fallback_status: Optional[int] = None
    fallback_ms: Optional[int] = None
    ladder_attempts = 0
    primary_quota_exhausted = False   # short-circuit flag, see docstring above

    # Non-retryable status codes — auth / bad-request / config problems.
    _NON_RETRYABLE = frozenset({400, 401, 403})

    for retry_i in range(GEMINI_MAX_LADDER_RETRIES + 1):
        ladder_attempts = retry_i + 1
        backoff_seconds: float = 0.0
        if retry_i > 0:
            backoff_seconds = min(
                GEMINI_RETRY_BASE_S * (2 ** (retry_i - 1)) + _random.uniform(0.0, 0.5),
                GEMINI_RETRY_MAX_S,
            )
            log.warning(
                "scan-ai[%s/%s]: ladder attempt %d — sleeping %.2fs backoff before retry "
                "(prev primary=%d fallback=%s primary_quota_exhausted=%s)",
                AI_PROVIDER, request_id, retry_i + 1, backoff_seconds, primary_status,
                fallback_status if fallback_status is not None else "-",
                str(primary_quota_exhausted).lower(),
            )
            time.sleep(backoff_seconds)
            # Reset per-attempt status carriers (keep primary_quota_exhausted
            # sticky — the whole point is that quota doesn't recover in-request).
            primary_status = 200
            primary_ms = 0
            fallback_status = None
            fallback_ms = None

        retry_target = "primary+fallback"
        primary_skipped_after_quota = False

        # ---- Primary (or SKIP if hard quota already known) ------------
        if primary_quota_exhausted:
            # Confirmed dead for this request. Do NOT call primary again.
            primary_skipped_after_quota = True
            retry_target = "fallback"
            log.info(
                "scan-ai[%s/%s]: attempt-%d SKIPPING primary %s "
                "(primary_quota_exhausted=true from earlier attempt)",
                AI_PROVIDER, request_id, ladder_attempts, primary_model,
            )
        else:
            log.info("scan-ai[%s/%s]: attempt-%d primary %s (%dx%d, read_timeout=%dms) ...",
                     AI_PROVIDER, request_id, ladder_attempts, primary_model,
                     w_img, h_img, call_timeout_ms)
            _t0 = time.time()
            try:
                resp = _ai_generate(client, primary_model, img_pil, GEMINI_PROMPT)
                primary_ms = int((time.time() - _t0) * 1000)
                log.info("scan-ai[%s/%s]: attempt-%d primary %s OK in %.1fs",
                         AI_PROVIDER, request_id, ladder_attempts, primary_model, primary_ms / 1000.0)
                _log_ladder(
                    request_id=request_id, ladder_attempt=ladder_attempts,
                    primary_status=primary_status,
                    primary_error_category="success",
                    primary_skipped_after_quota="false",
                    fallback_status="-", fallback_error_category="-",
                    retry_target=retry_target,
                    backoff_seconds=f"{backoff_seconds:.2f}",
                    final_outcome="primary_ok",
                )
                break
            except Exception as e:
                primary_ms = int((time.time() - _t0) * 1000)
                primary_status = _err_status(e)
                if primary_status == 429 and _is_ai_hard_quota_error(e):
                    primary_quota_exhausted = True
                    log.warning(
                        "scan-ai[%s/%s]: attempt-%d primary %s HARD-QUOTA 429 in %.1fs "
                        "(daily/free-tier/billing cap hit) — flagging primary as skipped "
                        "for the rest of this request",
                        AI_PROVIDER, request_id, ladder_attempts, primary_model, primary_ms / 1000.0,
                    )
                else:
                    log.warning(
                        "scan-ai[%s/%s]: attempt-%d primary %s FAILED in %.1fs status=%d cat=%s err=%s: %s",
                        AI_PROVIDER, request_id, ladder_attempts, primary_model,
                        primary_ms / 1000.0, primary_status,
                        _err_category(primary_status), type(e).__name__, str(e)[:200],
                    )

            # Non-retryable on primary → bail out of the retry envelope
            # entirely. No fallback attempt either — 400/401/403 mean auth
            # or bad payload; the fallback model would return the same
            # class of error.
            if primary_status in _NON_RETRYABLE:
                log.warning("scan-ai[%s/%s]: attempt-%d primary non-retryable (status=%d), "
                            "skipping fallback + halting retries",
                            AI_PROVIDER, request_id, ladder_attempts, primary_status)
                _log_ladder(
                    request_id=request_id, ladder_attempt=ladder_attempts,
                    primary_status=primary_status,
                    primary_error_category=_err_category(primary_status),
                    primary_skipped_after_quota="false",
                    fallback_status="-", fallback_error_category="-",
                    retry_target="none",
                    backoff_seconds=f"{backoff_seconds:.2f}",
                    final_outcome="halted_non_retryable_primary",
                )
                break

        # ---- Fallback --------------------------------------------------
        # Reached either because primary failed retryable, or because
        # primary was skipped due to prior hard quota.
        should_fallback = (
            (primary_skipped_after_quota
             or primary_status in _FALLBACK_STATUS_CODES)
            and fallback_model
            and fallback_model != primary_model
        )
        if should_fallback:
            log.warning(
                "scan-ai[%s/%s]: attempt-%d falling back %s -> %s "
                "(primary_status=%s primary_skipped_after_quota=%s)",
                AI_PROVIDER, request_id, ladder_attempts, primary_model, fallback_model,
                "skipped" if primary_skipped_after_quota else primary_status,
                str(primary_skipped_after_quota).lower(),
            )
            _t0 = time.time()
            try:
                resp = _ai_generate(client, fallback_model, img_pil, GEMINI_PROMPT)
                fallback_ms = int((time.time() - _t0) * 1000)
                fallback_status = 200
                model_used = fallback_model
                log.info("scan-ai[%s/%s]: attempt-%d fallback %s OK in %.1fs",
                         AI_PROVIDER, request_id, ladder_attempts, fallback_model,
                         fallback_ms / 1000.0)
                _log_ladder(
                    request_id=request_id, ladder_attempt=ladder_attempts,
                    primary_status=primary_status if not primary_skipped_after_quota else "-",
                    primary_error_category=(
                        "-" if primary_skipped_after_quota
                        else _err_category(primary_status)
                    ),
                    primary_skipped_after_quota=str(primary_skipped_after_quota).lower(),
                    fallback_status=200, fallback_error_category="success",
                    retry_target=retry_target,
                    backoff_seconds=f"{backoff_seconds:.2f}",
                    final_outcome="fallback_ok",
                )
                break
            except Exception as e2:
                fallback_ms = int((time.time() - _t0) * 1000)
                fallback_status = _err_status(e2)
                log.error(
                    "scan-ai[%s/%s]: attempt-%d fallback %s FAILED in %.1fs status=%d cat=%s err=%s: %s",
                    AI_PROVIDER, request_id, ladder_attempts, fallback_model,
                    fallback_ms / 1000.0, fallback_status,
                    _err_category(fallback_status), type(e2).__name__, str(e2)[:200],
                )
                _log_ladder(
                    request_id=request_id, ladder_attempt=ladder_attempts,
                    primary_status=primary_status if not primary_skipped_after_quota else "-",
                    primary_error_category=(
                        "-" if primary_skipped_after_quota
                        else _err_category(primary_status)
                    ),
                    primary_skipped_after_quota=str(primary_skipped_after_quota).lower(),
                    fallback_status=fallback_status,
                    fallback_error_category=_err_category(fallback_status),
                    retry_target="fallback" if primary_quota_exhausted else "primary+fallback",
                    backoff_seconds=f"{backoff_seconds:.2f}",
                    final_outcome="attempt_failed_will_retry" if retry_i < GEMINI_MAX_LADDER_RETRIES else "attempt_failed_final",
                )
                if fallback_status in _NON_RETRYABLE:
                    log.warning("scan-ai[%s/%s]: attempt-%d fallback non-retryable, halting retries",
                                AI_PROVIDER, request_id, ladder_attempts)
                    break

        # If we get here, current attempt failed retryable. Loop continues.

    # ------------------------------------------------------------------
    # If both attempts failed, resolve the user-visible error taxonomy
    # and raise a STRUCTURED HTTPException (dict detail). Never leak raw
    # Python exception strings to the frontend.
    # ------------------------------------------------------------------
    if resp is None:
        error_code, http_status, retryable, message = _resolve_final_error(
            primary_status, fallback_status,
        )
        # Outcome counter — one entry per request, key uses categories not
        # raw statuses so the total set stays small.
        outcome_key = (
            f"both_failed:{_err_category(primary_status)}"
            f":{_err_category(fallback_status) if fallback_status is not None else 'no_fallback'}"
        )
        _gemini_outcomes[outcome_key] += 1
        _gemini_outcomes[f"result:{error_code}"] += 1
        log.warning(
            "scan-ai[%s]: FINAL outcome=%s error_code=%s http=%d image=%dx%d "
            "ladder_attempts=%d primary=%d(%dms) fallback=%s(%sms)",
            AI_PROVIDER, outcome_key, error_code, http_status, w_img, h_img,
            ladder_attempts, primary_status, primary_ms,
            fallback_status if fallback_status is not None else "-",
            fallback_ms if fallback_ms is not None else "-",
        )
        raise HTTPException(status_code=http_status, detail={
            "error_code": error_code,
            "message": message,
            "retryable": retryable,
            "primary_status": primary_status,
            "fallback_status": fallback_status,
        })

    text = (getattr(resp, "text", None) or "").strip()

    # Primary parse; fall back to stripping markdown fences if the model
    # slipped a ```json ... ``` wrapper in despite the mime hint.
    parsed = None
    parse_error = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        stripped = text.lstrip("`").rstrip("`").strip()
        for tag in ("json\n", "JSON\n", "json ", "JSON "):
            if stripped.startswith(tag):
                stripped = stripped[len(tag):]
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parse_error = str(e)

    if parsed is None:
        log.warning("scan-ai[%s]: could not parse JSON from provider. err=%s first200=%r",
                    AI_PROVIDER, parse_error, text[:200])
        # Return an empty-but-well-formed response so the frontend still
        # shows "auto-detect found nothing" instead of erroring out.
        return ScanResponse(
            image_width=w_img,
            image_height=h_img,
            chairs=[],
            tables_round=[],
            tables_rect=[],
            thresholds={
                "detection_method": 4.0,
                "parse_ok": 0.0,
            },
        )

    objects = parsed.get("objects", []) if isinstance(parsed, dict) else []
    if not isinstance(objects, list):
        objects = []

    chairs: List[Dict[str, Any]] = []
    tables_round: List[Dict[str, Any]] = []
    tables_rect: List[Dict[str, Any]] = []
    invalid = 0

    for obj in objects:
        if not isinstance(obj, dict):
            invalid += 1
            continue
        cls = str(obj.get("class", "")).strip().lower()
        shape = str(obj.get("shape", "")).strip().lower()
        conf_raw = obj.get("confidence", 0.0)
        try:
            conf = float(conf_raw)
        except (TypeError, ValueError):
            conf = 0.0
        conf = max(0.0, min(1.0, conf))

        px = _gemini_box_to_pixels(obj.get("box_2d"), w_img, h_img)
        if px is None:
            invalid += 1
            continue
        x1, y1, x2, y2 = px
        w = x2 - x1
        h = y2 - y1

        if cls == "chair":
            chairs.append({
                "x": int(x1), "y": int(y1),
                "w": int(w), "h": int(h),
                "conf": round(conf, 3),
            })
        elif cls == "table":
            # Trust Gemini's "shape" hint. Unlike YOLO/Architect where the
            # bbox is all we have, Gemini looked at the drawing and told us
            # whether the table is round; no need to re-run circularity.
            if shape == "round":
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                r = min(w, h) / 2.0
                tables_round.append({
                    "cx": int(cx), "cy": int(cy),
                    "r": int(r), "conf": round(conf, 3),
                })
            else:
                tables_rect.append({
                    "x": int(x1), "y": int(y1),
                    "w": int(w), "h": int(h),
                    "conf": round(conf, 3),
                })
        else:
            invalid += 1

    # Extract Gemini's actual token usage from the response metadata. We
    # NEVER estimate: if `usage_metadata` (or any individual field) is
    # missing we emit `n/a` for that value. Never raises.
    def _tok(attr: str):
        um = getattr(resp, "usage_metadata", None)
        if um is None:
            return "n/a"
        v = getattr(um, attr, None)
        return v if v is not None else "n/a"

    prompt_tokens = _tok("prompt_token_count")
    output_tokens = _tok("candidates_token_count")
    total_tokens  = _tok("total_token_count")

    # Latency of the call that actually returned the response — fallback
    # if it ran, otherwise the primary. `primary_ms` and `fallback_ms` are
    # captured earlier around each attempt.
    used_latency_ms = fallback_ms if fallback_ms is not None else primary_ms

    # Success-path counter increment. `outcome` is one of:
    #   primary_ok            — first attempt succeeded
    #   fallback_ok           — primary failed, fallback rescued the request
    success_outcome = "primary_ok" if model_used == primary_model else "fallback_ok"
    _gemini_outcomes[success_outcome] += 1
    _gemini_outcomes["result:OK"] += 1

    # Structured single-line usage log for CMD/terminal observability.
    # Values from the provider response's own usage_metadata — never estimated.
    log.info(
        "ai usage provider=%s model=%s status=200 latency_ms=%d "
        "prompt_tokens=%s output_tokens=%s total_tokens=%s",
        AI_PROVIDER, model_used, used_latency_ms,
        prompt_tokens, output_tokens, total_tokens,
    )

    # Operational summary line (chair/table counts, image dims, per-attempt
    # timings). Kept separate from the token log so log parsers can pick up
    # either concern cleanly.
    log.info(
        "scan-ai[%s]: outcome=%s model=%s%s image=%dx%d chairs=%d tables_round=%d "
        "tables_rect=%d invalid=%d primary_ms=%d fallback_ms=%s",
        AI_PROVIDER, success_outcome, model_used,
        (" (fallback)" if model_used != primary_model else ""),
        w_img, h_img, len(chairs), len(tables_round), len(tables_rect), invalid,
        primary_ms,
        fallback_ms if fallback_ms is not None else "-",
    )

    return ScanResponse(
        image_width=w_img,
        image_height=h_img,
        chairs=chairs,
        tables_round=tables_round,
        tables_rect=tables_rect,
        thresholds={
            # 4.0 = Gemini vision model handled the scan.
            "detection_method": 4.0,
            "parse_ok": 1.0,
        },
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5001))
    uvicorn.run("app:app", host=os.environ.get("HOST", "127.0.0.1"), port=port, reload=True)
