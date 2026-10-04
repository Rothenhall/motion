"""Runs TRIBE v2 on a video and returns per-second brain-system activity.

Needs a ~32 GB GPU, the tribev2 package and a Hugging Face token approved for
Llama 3.2-3B (HF_TOKEN). Everything heavy is imported lazily so the scoring code and
tests run without it.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

import networks

log = logging.getLogger("tribe.runner")

CACHE_DIR = Path(os.getenv("TRIBE_CACHE_DIR", "./cache"))
MODEL_ID = os.getenv("TRIBE_MODEL_ID", "facebook/tribev2")


@dataclass
class ClipPrediction:
    nets: dict[str, np.ndarray]
    words: list[dict] = field(default_factory=list)

    @property
    def speech_seconds(self) -> set[int]:
        return {int(w["start"]) for w in self.words}


def has_audio(path: Path) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=False,
    )
    return bool(out.stdout.strip())


def muted_copy(path: Path, out_dir: Path) -> Path:
    """Same video with a silent soundtrack: how it plays on autoplay in a muted feed."""
    out = out_dir / f"muted{path.suffix if path.suffix in ('.mp4', '.mov') else '.mp4'}"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:v", "copy", "-c:a", "aac", str(out)],
        check=True,
    )
    return out


def per_second(preds: np.ndarray, segments: list) -> np.ndarray:
    """Places each predicted segment at its second, filling seconds TRIBE skipped as empty."""
    starts = [getattr(s, "start", None) for s in segments]
    if len(starts) != len(preds) or any(not isinstance(t, (int, float)) for t in starts):
        return preds
    idx = np.floor(np.asarray(starts, dtype=float) + 1e-6).astype(int)
    idx -= idx.min()
    out = np.full((idx.max() + 1, preds.shape[1]), np.nan, dtype=float)
    out[idx] = preds
    # Forward/back fill gaps so every second has a value.
    for i in range(1, len(out)):
        if np.isnan(out[i, 0]):
            out[i] = out[i - 1]
    for i in range(len(out) - 2, -1, -1):
        if np.isnan(out[i, 0]):
            out[i] = out[i + 1]
    return out


def words_from_events(events) -> list[dict]:
    """Transcript with timings, when the events table has word rows (best effort)."""
    try:
        rows = events[events["type"] == "Word"]
        words = []
        for _, row in rows.iterrows():
            text = str(row.get("text", "")).strip()
            if text and text != "nan":
                words.append({"word": text, "start": round(float(row["start"]), 2), "duration": round(float(row.get("duration", 0) or 0), 2)})
        return sorted(words, key=lambda w: w["start"])
    except Exception as error:  # noqa: BLE001 - transcript is optional
        log.warning("could not read words from events: %s", error)
        return []


class TribeRunner:
    def __init__(self) -> None:
        self._model = None
        self._roi_map: dict[str, np.ndarray] | None = None
        # One GPU, one clip at a time.
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        from tribev2 import TribeModel

        log.info("loading %s (this downloads ~20 GB of weights on first start)", MODEL_ID)
        self._model = TribeModel.from_pretrained(MODEL_ID, cache_folder=str(CACHE_DIR))
        self._roi_map = networks.load_roi_map(CACHE_DIR / "roi_map.npz")

    def _predict(self, video: Path) -> ClipPrediction:
        events = self._model.get_events_dataframe(video_path=str(video))
        preds, segments = self._model.predict(events=events, verbose=False)
        return ClipPrediction(nets=networks.reduce(per_second(preds, segments), self._roi_map), words=words_from_events(events))

    def run(self, video: Path, sound_off: bool = True) -> tuple[ClipPrediction, ClipPrediction | None, bool]:
        """Returns (full clip, muted clip or None, whether the clip had audio)."""
        self.load()
        with self._lock, tempfile.TemporaryDirectory() as tmp:
            audio = has_audio(video)
            full = self._predict(video)
            muted = self._predict(muted_copy(video, Path(tmp))) if sound_off and audio else None
            return full, muted, audio
