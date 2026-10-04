"""Turn per-second brain-system activity into the scores and moments Motion's insights use.

Everything here is plain numpy so it can be tested without a GPU.

Two baselines:
- "library": a reference.json built from a set of reels (see build_reference.py). Scores
  then mean "compared with typical reels" and carry percentiles.
- "clip": no reference available. Each system is standardised against the clip itself, so
  scores mean "compared with the rest of this video" (still useful for a weak opening or a
  mid-video dip, but not for absolute statements).

These are uncalibrated estimates of how an average viewer's brain would process the clip,
not measured viewer behaviour. Motion labels them that way.
"""
from __future__ import annotations

from typing import Any

import numpy as np

HOOK_SECONDS = 3
SHORT_CLIP_SECONDS = 15
# Systems whose rise means "attending to the screen"; default mode rising means drifting off.
ATTENTION_PARTS = ("attention", "visual_motion", "auditory", "faces")
CURVES = ("attention_index", "faces", "language", "text_reading", "social", "auditory", "visual_motion", "scenes")
# Systems that can explain a moment (the composite is what the moment is about, so it is left out).
DRIVER_SYSTEMS = ("faces", "language", "text_reading", "social", "auditory", "visual_motion", "scenes", "early_visual", "attention", "default_mode")
MAX_DRIVERS = 3
DRIVER_MIN_Z = 0.5
EPS = 1e-6


def to100(z: float) -> int:
    """z-score -> 0-100 display scale (50 = typical, ~±15 per standard deviation)."""
    return int(round(float(np.clip(50 + 15 * z, 0, 100))))


def smooth(x: np.ndarray) -> np.ndarray:
    if len(x) < 3:
        return x.astype(float)
    kernel = np.ones(3)
    return np.convolve(x, kernel, mode="same") / np.convolve(np.ones_like(x, dtype=float), kernel, mode="same")


def attention_index(nets: dict[str, np.ndarray], stats: dict[str, tuple[float, float]]) -> np.ndarray:
    z = {k: (nets[k] - stats[k][0]) / stats[k][1] for k in (*ATTENTION_PARTS, "default_mode")}
    return np.mean([z[k] for k in ATTENTION_PARTS], axis=0) - 0.5 * z["default_mode"]


def network_stats(nets: dict[str, np.ndarray]) -> dict[str, tuple[float, float]]:
    """Mean / std of each system across the clip, plus the composite attention index."""
    stats = {k: (float(v.mean()), float(v.std()) + EPS) for k, v in nets.items()}
    composite = attention_index(nets, stats)
    stats["attention_index"] = (float(composite.mean()), float(composite.std()) + EPS)
    return stats


def runs(mask: np.ndarray, min_len: int, offset: int = 0) -> list[tuple[int, int]]:
    """Contiguous True runs of at least min_len, as (start_second, end_second_exclusive)."""
    out, start = [], None
    for i, flag in enumerate(list(mask) + [False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            if i - start >= min_len:
                out.append((start + offset, i + offset))
            start = None
    return out


def percentile(samples: list[float] | None, value: float) -> float | None:
    if not samples:
        return None
    return round(100.0 * float(np.mean(np.asarray(samples) <= value)), 1)


def drivers(zs: dict[str, np.ndarray], start: int, end: int) -> list[dict[str, Any]]:
    """The systems that stand out most during [start, end): what likely explains the moment."""
    window = {k: float(zs[k][start:end].mean()) for k in DRIVER_SYSTEMS if k in zs}
    ranked = sorted(window.items(), key=lambda kv: -abs(kv[1]))
    return [{"system": k, "direction": "high" if v > 0 else "low", "z": round(v, 2)} for k, v in ranked[:MAX_DRIVERS] if abs(v) >= DRIVER_MIN_Z]


def analyze(
    nets: dict[str, np.ndarray],
    silent: dict[str, np.ndarray] | None = None,
    speech_seconds: set[int] | None = None,
    reference: dict[str, Any] | None = None,
) -> dict[str, Any]:
    n = min(len(v) for v in nets.values())
    if n == 0:
        raise ValueError("no predictions to score")
    nets = {k: np.asarray(v[:n], dtype=float) for k, v in nets.items()}

    if reference and reference.get("networks"):
        baseline = "library"
        stats = {k: (float(v["mean"]), float(v["std"]) + EPS) for k, v in reference["networks"].items()}
    else:
        baseline = "clip"
        stats = network_stats(nets)
    ref_scores = (reference or {}).get("scores", {}) if baseline == "library" else {}

    z = {k: (nets[k] - stats[k][0]) / stats[k][1] for k in nets}
    z["attention_index"] = (attention_index(nets, stats) - stats["attention_index"][0]) / stats["attention_index"][1]
    zs = {k: smooth(v) for k, v in z.items()}
    att = zs["attention_index"]

    hook_n = min(HOOK_SECONDS, n)
    hook_z = float(att[:hook_n].mean())
    hold_z = float(att.mean())
    end_z = float(att[-HOOK_SECONDS:].mean())

    def score(key: str, value_z: float) -> dict[str, Any]:
        return {"value": to100(value_z), "percentile": percentile(ref_scores.get(key), value_z), "z": round(value_z, 3)}

    scores: dict[str, Any] = {
        "hook": score("hook", hook_z),
        "hold": score("hold", hold_z),
        "ending": score("ending", end_z),
        "human_pull_opening": score("human_pull_opening", float(zs["faces"][:hook_n].mean())),
        "emotional_resonance": score("emotional_resonance", float(zs["social"].mean())),
        "text_load_peak": score("text_load_peak", float(zs["text_reading"].max())),
        "message_clarity": None,
        "sound_off_resilience": None,
    }

    speech = sorted(s for s in (speech_seconds or set()) if 0 <= s < n)
    if len(speech) >= 2:
        scores["message_clarity"] = score("message_clarity", float(zs["language"][speech].mean()))

    sound_off_curve = None
    if silent:
        m = min(n, *(len(v) for v in silent.values()))
        quiet = {k: np.asarray(v[:m], dtype=float) for k, v in silent.items()}
        # Same normalisation as the full clip, so the two are directly comparable.
        quiet_att = smooth((attention_index(quiet, stats) - stats["attention_index"][0]) / stats["attention_index"][1])
        quiet_lang = smooth((quiet["language"] - stats["language"][0]) / stats["language"][1])
        drop = float(np.mean([(att[:m] - quiet_att).mean(), (zs["language"][:m] - quiet_lang).mean()]))
        resilience = float(np.clip(100 - 30 * max(drop, 0.0), 0, 100))
        scores["sound_off_resilience"] = {"value": int(round(resilience)), "percentile": percentile(ref_scores.get("sound_off_resilience"), -drop), "z": round(-drop, 3)}
        sound_off_curve = [to100(v) for v in quiet_att]

    moments: list[dict[str, Any]] = []
    for start, end in runs(att[HOOK_SECONDS:] < -0.67, 2, offset=HOOK_SECONDS):
        moments.append({"kind": "drop_risk", "start": start, "end": end, "level": to100(float(att[start:end].mean()))})
    for start, end in runs(zs["text_reading"] > 1.5, 2):
        moments.append({"kind": "text_overload", "start": start, "end": end, "level": to100(float(zs["text_reading"][start:end].mean()))})
    peak = int(np.argmax(att))
    moments.append({"kind": "peak", "start": peak, "end": peak + 1, "level": to100(float(att[peak]))})
    for mo in moments:
        mo["drivers"] = drivers(zs, mo["start"], mo["end"])
    moments.sort(key=lambda mo: (mo["start"], mo["kind"]))

    faces_on = np.flatnonzero(zs["faces"] > 0.5)
    return {
        "baseline": baseline,
        "reference_label": (reference or {}).get("label") if baseline == "library" else None,
        "seconds": n,
        "curves": {k: [to100(v) for v in zs[k]] for k in CURVES if k in zs},
        "sound_off_attention": sound_off_curve,
        "scores": scores,
        "facts": {
            "first_face_second": int(faces_on[0]) if len(faces_on) else None,
            "short_clip": n < SHORT_CLIP_SECONDS,
            "speech_seconds": len(speech),
        },
        "moments": moments,
    }
