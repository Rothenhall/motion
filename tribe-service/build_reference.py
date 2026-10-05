"""Build reference.json: the "typical reel" baseline that turns scores into percentiles.

    python build_reference.py --label "fitness reels" path/to/reels/*.mp4

Run it on a few hundred reels from one niche (ideally ones whose real performance you know,
so the same set can later calibrate the scores). Without a reference the service still
works, but compares each clip only against itself.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np

import scoring
from runner import TribeRunner

SCORE_KEYS = ("hook", "hold", "ending", "human_pull_opening", "emotional_resonance", "text_load_peak", "message_clarity", "sound_off_resilience")


def build(clips: list[tuple[dict[str, np.ndarray], dict[str, np.ndarray] | None, set[int]]], label: str) -> dict:
    pooled = {k: np.concatenate([nets[k] for nets, _, _ in clips]) for k in clips[0][0]}
    stats = {k: (float(v.mean()), float(v.std()) + scoring.EPS) for k, v in pooled.items()}
    composite = np.concatenate([scoring.attention_index(nets, stats) for nets, _, _ in clips])
    stats["attention_index"] = (float(composite.mean()), float(composite.std()) + scoring.EPS)
    reference = {"label": label, "n_clips": len(clips), "networks": {k: {"mean": m, "std": s} for k, (m, s) in stats.items()}}

    samples: dict[str, list[float]] = {k: [] for k in SCORE_KEYS}
    for nets, silent, speech in clips:
        result = scoring.analyze(nets, silent=silent, speech_seconds=speech, reference=reference)
        for key in SCORE_KEYS:
            if result["scores"].get(key):
                samples[key].append(result["scores"][key]["z"])
    reference["scores"] = {k: sorted(v) for k, v in samples.items() if v}
    return reference


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--label", required=True)
    parser.add_argument("--out", type=Path, default=Path("reference.json"))
    args = parser.parse_args()

    runner = TribeRunner()
    clips = []
    for video in args.videos:
        try:
            full, muted, _ = runner.run(video)
            clips.append((full.nets, muted.nets if muted else None, full.speech_seconds))
            logging.info("analysed %s", video)
        except Exception:  # noqa: BLE001 - skip unreadable clips
            logging.exception("skipping %s", video)
    if len(clips) < 20:
        raise SystemExit(f"only {len(clips)} clips analysed; use at least 20 (a few hundred is better)")
    args.out.write_text(json.dumps(build(clips, args.label)))
    print(f"wrote {args.out} from {len(clips)} clips")


if __name__ == "__main__":
    main()
