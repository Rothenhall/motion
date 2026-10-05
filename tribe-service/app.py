"""Motion audience simulation service: TRIBE v2 behind a small HTTP API.

POST /analyze  (multipart: file=<video>, sound_off=true|false, include_brain=true|false)
  -> per-second curves (0-100), scores, flagged moments and a transcript; with
     include_brain, also the compressed per-second cortical map (see networks.encode_brain).
GET  /health

The Motion backend calls this when TRIBE_SERVICE_URL is set. Set TRIBE_SERVICE_TOKEN on
both sides so only the backend can use the GPU.

TRIBE v2 is licensed CC BY-NC 4.0: internal research use only.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

import scoring
from networks import encode_brain
from runner import CACHE_DIR, MODEL_ID, TribeRunner

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("tribe.app")

SERVICE_VERSION = "1"
MAX_BYTES = 100 * 1024 * 1024
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
MAX_TRANSCRIPT_WORDS = 400


def load_reference() -> dict[str, Any] | None:
    path = Path(os.getenv("TRIBE_REFERENCE_PATH", "reference.json"))
    if not path.exists():
        return None
    reference = json.loads(path.read_text())
    log.info("loaded reference library %r (%s clips)", reference.get("label"), reference.get("n_clips"))
    return reference


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("TRIBE_PRELOAD", "1") == "1":
        try:
            app.state.runner.load()
        except Exception:  # noqa: BLE001 - /health reports it; /analyze retries the load
            log.exception("model failed to load at startup")
    yield


app = FastAPI(title="Motion audience simulation", version=SERVICE_VERSION, lifespan=lifespan)
app.state.runner = TribeRunner()
app.state.reference = load_reference()


def check_token(authorization: str | None) -> None:
    expected = os.getenv("TRIBE_SERVICE_TOKEN")
    if not expected:
        return
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not secrets.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="bad token")


@app.get("/health")
def health() -> dict[str, Any]:
    ref = app.state.reference
    return {"ok": True, "model": MODEL_ID, "model_loaded": app.state.runner.loaded, "reference": ref.get("label") if ref else None, "version": SERVICE_VERSION}


@app.post("/analyze")
def analyze(
    file: UploadFile = File(...),
    sound_off: bool = Form(True),
    include_brain: bool = Form(False),
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    check_token(authorization)
    suffix = Path(file.filename or "clip.mp4").suffix.lower() or ".mp4"
    if suffix not in VIDEO_SUFFIXES:
        raise HTTPException(status_code=400, detail="send a video file")

    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / f"clip{suffix}"
        digest = hashlib.sha256()
        size = 0
        with video.open("wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(status_code=413, detail="video too large")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="empty file")

        ref = app.state.reference
        key = f"{digest.hexdigest()}-{int(sound_off)}-{int(include_brain)}-{SERVICE_VERSION}-{(ref or {}).get('label', 'clip')}"
        cached = CACHE_DIR / "results" / f"{hashlib.sha256(key.encode()).hexdigest()}.json"
        if cached.exists():
            return json.loads(cached.read_text())

        try:
            full, muted, has_audio = app.state.runner.run(video, sound_off=sound_off)
        except Exception as error:  # noqa: BLE001
            log.exception("TRIBE run failed")
            raise HTTPException(status_code=500, detail=f"analysis failed: {type(error).__name__}") from error

    result = scoring.analyze(full.nets, silent=muted.nets if muted else None, speech_seconds=full.speech_seconds, reference=ref)
    result.update({
        "model": MODEL_ID,
        "version": SERVICE_VERSION,
        "has_audio": has_audio,
        "transcript": full.words[:MAX_TRANSCRIPT_WORDS],
    })
    if include_brain and full.vertices is not None:
        result["brain"] = encode_brain(full.vertices)
    cached.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = cached.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(result))
    shutil.move(tmp_path, cached)
    return result
