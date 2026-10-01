"""
Test suite for POST /scan-gemini error handling and outcome counter.

Uses FastAPI's TestClient with the module-level `_gemini_generate` helper
monkey-patched to simulate every relevant failure mode. No live Google
calls are made — this exercises the ladder logic + error taxonomy +
counter deterministically.

Scenarios (per user spec in TASK 7 of the reliability audit):
  1. Primary success (200 OK on first attempt)
  2. Primary ReadTimeout → fallback success
  3. Primary ReadTimeout → fallback 504
  4. Primary 429 quota → fallback success
  5. Invalid API key (surfaced as 401 → GEMINI_CONFIG_ERROR)

Extra scenarios worth asserting for confidence:
  6. Both models 429 → GEMINI_QUOTA_EXHAUSTED
  7. Both models 400 → INVALID_IMAGE
  8. Invalid image before we ever call Gemini → INVALID_IMAGE (413/415)
"""
from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import cv2
import httpx
from fastapi.testclient import TestClient

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import app as svc  # imports the FastAPI app; triggers YOLO/Architect lifespan on request


def _find_test_image() -> bytes:
    """A tiny valid PNG so upload / decode succeeds; we only care about the ladder logic."""
    cands = sorted(HERE.glob("templates/chairs/*.png"))
    if cands:
        with open(cands[0], "rb") as f:
            return f.read()
    # Fallback: synthesise a 32x32 black square
    import numpy as np
    arr = (np.ones((32, 32, 3), dtype="uint8") * 128)
    ok, buf = cv2.imencode(".png", arr)
    return bytes(buf)


IMG_BYTES = _find_test_image()


class _FakeResponse:
    """Mimic just enough of google-genai's response for the endpoint's happy path."""
    def __init__(self, text: str = '{"objects": []}'):
        self.text = text
        self.usage_metadata = None


def _make_api_error(code: int, message: str = "simulated"):
    """Build a google-genai APIError-like exception with .code attribute."""
    from google.genai import errors as ge
    if code == 429:
        cls = ge.ClientError
    elif code in (400, 401, 403, 404):
        cls = ge.ClientError
    elif code in (500, 502, 503, 504):
        cls = ge.ServerError
    else:
        cls = ge.APIError
    # ge.APIError signature: (code, response_json, response=None)
    return cls(code, {"error": {"code": code, "message": message}}, None)


def _make_read_timeout():
    return httpx.ReadTimeout("simulated read timeout")


def _bypass_client_init():
    """Stub _get_gemini_client so tests don't need a real API key."""
    svc._gemini_client = MagicMock()
    svc._gemini_client_error = ""
    return lambda: (svc._gemini_client, "")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def setup_module(_):
    # Force the fake client in place so _get_gemini_client() is a no-op.
    svc._get_gemini_client = _bypass_client_init()
    # Reset counter between test runs
    svc._gemini_outcomes.clear()


def teardown_module(_):
    svc._gemini_outcomes.clear()


client = TestClient(svc.app)


def _post_scan():
    return client.post(
        "/scan-gemini",
        files={"image": ("test.png", IMG_BYTES, "image/png")},
    )


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def test_1_primary_success():
    svc._gemini_outcomes.clear()
    with patch.object(svc, "_gemini_generate", return_value=_FakeResponse()):
        r = _post_scan()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["thresholds"]["detection_method"] == 4.0
    assert svc._gemini_outcomes.get("primary_ok") == 1
    assert svc._gemini_outcomes.get("result:OK") == 1


def test_2_primary_timeout_fallback_success():
    svc._gemini_outcomes.clear()
    call_seq = [_make_read_timeout(), _FakeResponse()]
    def side(*a, **kw):
        v = call_seq.pop(0)
        if isinstance(v, BaseException):
            raise v
        return v
    with patch.object(svc, "_gemini_generate", side_effect=side):
        r = _post_scan()
    assert r.status_code == 200, r.text
    assert svc._gemini_outcomes.get("fallback_ok") == 1
    assert svc._gemini_outcomes.get("result:OK") == 1


def test_3_primary_timeout_fallback_504():
    svc._gemini_outcomes.clear()
    errs = [_make_read_timeout(), _make_api_error(504, "DEADLINE_EXCEEDED")]
    def side(*a, **kw): raise errs.pop(0)
    with patch.object(svc, "_gemini_generate", side_effect=side):
        r = _post_scan()
    assert r.status_code == 503, r.text
    body = r.json()
    detail = body["detail"]
    assert detail["error_code"] == "GEMINI_UNAVAILABLE"
    assert detail["retryable"] is True
    assert detail["primary_status"] == 0
    assert detail["fallback_status"] == 504
    # Counter must have recorded both-failed with the exact category shape
    assert svc._gemini_outcomes.get("both_failed:timeout:upstream_5xx") == 1
    assert svc._gemini_outcomes.get("result:GEMINI_UNAVAILABLE") == 1


def test_4_primary_429_fallback_success():
    svc._gemini_outcomes.clear()
    seq = [_make_api_error(429, "rate limited"), _FakeResponse()]
    def side(*a, **kw):
        v = seq.pop(0)
        if isinstance(v, BaseException): raise v
        return v
    with patch.object(svc, "_gemini_generate", side_effect=side):
        r = _post_scan()
    assert r.status_code == 200, r.text
    assert svc._gemini_outcomes.get("fallback_ok") == 1


def test_5_invalid_api_key_401():
    svc._gemini_outcomes.clear()
    # Google returns 401 on invalid keys; both attempts hit the same wall.
    err = _make_api_error(401, "invalid key")
    with patch.object(svc, "_gemini_generate", side_effect=err):
        r = _post_scan()
    assert r.status_code == 503, r.text
    detail = r.json()["detail"]
    assert detail["error_code"] == "GEMINI_CONFIG_ERROR"
    assert detail["retryable"] is False


# Extra confidence checks -----------------------------------------------------

def test_6_both_models_429_quota():
    svc._gemini_outcomes.clear()
    err = _make_api_error(429, "quota exceeded")
    with patch.object(svc, "_gemini_generate", side_effect=err):
        r = _post_scan()
    assert r.status_code == 429, r.text
    detail = r.json()["detail"]
    assert detail["error_code"] == "GEMINI_QUOTA_EXHAUSTED"
    assert detail["retryable"] is True


def test_7_both_models_400_bad_request():
    svc._gemini_outcomes.clear()
    err = _make_api_error(400, "bad request")
    with patch.object(svc, "_gemini_generate", side_effect=err):
        r = _post_scan()
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert detail["error_code"] == "INVALID_IMAGE"
    assert detail["retryable"] is False


def test_8_pre_gemini_invalid_image_wrong_content_type():
    r = client.post(
        "/scan-gemini",
        files={"image": ("test.txt", b"not an image", "text/plain")},
    )
    assert r.status_code == 415, r.text
    detail = r.json()["detail"]
    assert detail["error_code"] == "INVALID_IMAGE"
    assert detail["retryable"] is False


def test_9_gemini_stats_endpoint_shape():
    """Just confirm /gemini-stats returns the expected structure."""
    r = client.get("/gemini-stats")
    assert r.status_code == 200
    body = r.json()
    assert "total_requests" in body
    assert "outcomes" in body
    assert isinstance(body["outcomes"], dict)


if __name__ == "__main__":
    # Simple runner so we don't need pytest installed
    setup_module(None)
    tests = [
        test_1_primary_success,
        test_2_primary_timeout_fallback_success,
        test_3_primary_timeout_fallback_504,
        test_4_primary_429_fallback_success,
        test_5_invalid_api_key_401,
        test_6_both_models_429_quota,
        test_7_both_models_400_bad_request,
        test_8_pre_gemini_invalid_image_wrong_content_type,
        test_9_gemini_stats_endpoint_shape,
    ]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
            failed += 1
    teardown_module(None)
    print(f"\n{passed}/{passed+failed} passed")
    sys.exit(0 if failed == 0 else 1)
