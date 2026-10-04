import numpy as np
import pytest

import networks
import scoring

SYSTEMS = list(networks.NETWORKS)


def clip(seconds=20, seed=0, **overrides):
    rng = np.random.default_rng(seed)
    nets = {k: rng.normal(0, 0.1, seconds) for k in SYSTEMS}
    for name, values in overrides.items():
        nets[name] = nets[name] + np.asarray(values, dtype=float)
    return nets


def ramp(seconds, low_until, low=-1.0, high=0.5):
    return np.where(np.arange(seconds) < low_until, low, high)


def test_reduce_averages_vertices_per_system():
    preds = np.zeros((2, networks.N_VERTICES))
    preds[:, :10] = 1.0
    roi = {"a": np.arange(0, 10), "b": np.arange(0, 20)}
    out = networks.reduce(preds, roi)
    assert out["a"].tolist() == [1.0, 1.0]
    assert out["b"].tolist() == [0.5, 0.5]
    with pytest.raises(ValueError):
        networks.reduce(np.zeros((2, 5)), roi)


def test_networks_split_hemispheres():
    for name, (hemi, areas) in networks.NETWORKS.items():
        assert hemi in ("both", "left", "right"), name
        assert areas, name


def test_slow_opening_scores_a_weak_hook():
    attention_up = ramp(20, 3)
    weak = scoring.analyze(clip(attention=attention_up, visual_motion=attention_up, auditory=attention_up, faces=attention_up))
    strong = scoring.analyze(clip(attention=-attention_up, visual_motion=-attention_up, auditory=-attention_up, faces=-attention_up))
    assert weak["baseline"] == "clip"
    assert weak["scores"]["hook"]["value"] < 40
    assert strong["scores"]["hook"]["value"] > 60
    assert weak["scores"]["hook"]["percentile"] is None


def test_mid_video_dip_is_flagged_with_timestamps():
    dip = np.zeros(20)
    dip[8:12] = -2.0
    result = scoring.analyze(clip(attention=dip, visual_motion=dip, auditory=dip, faces=dip))
    drops = [m for m in result["moments"] if m["kind"] == "drop_risk"]
    assert len(drops) == 1
    assert 7 <= drops[0]["start"] <= 9 and 11 <= drops[0]["end"] <= 13
    assert result["curves"]["attention_index"][9] < 30
    assert len(result["curves"]["attention_index"]) == 20


def test_moments_name_what_drives_them():
    dip = np.zeros(20)
    dip[8:12] = -2.0
    wander = np.zeros(20)
    wander[8:12] = 3.0
    result = scoring.analyze(clip(visual_motion=dip, faces=dip, default_mode=wander))
    drop = next(m for m in result["moments"] if m["kind"] == "drop_risk")
    named = {(d["system"], d["direction"]) for d in drop["drivers"]}
    assert ("default_mode", "high") in named
    assert named & {("visual_motion", "low"), ("faces", "low")}
    assert len(drop["drivers"]) <= scoring.MAX_DRIVERS
    assert all(abs(d["z"]) >= scoring.DRIVER_MIN_Z for m in result["moments"] for d in m["drivers"])


def test_mind_wandering_lowers_attention():
    wander = np.zeros(20)
    wander[10:15] = 3.0
    result = scoring.analyze(clip(default_mode=wander))
    assert min(result["curves"]["attention_index"][10:15]) < 50


def test_sound_off_resilience_drops_when_muting_hurts():
    full = clip(seed=1)
    same = {k: v.copy() for k, v in full.items()}
    hurt = {k: v.copy() for k, v in full.items()}
    for k in ("attention", "auditory", "language"):
        hurt[k] = hurt[k] - 1.0
    robust = scoring.analyze(full, silent=same)
    fragile = scoring.analyze(full, silent=hurt)
    assert robust["scores"]["sound_off_resilience"]["value"] == 100
    assert fragile["scores"]["sound_off_resilience"]["value"] < 70
    assert len(fragile["sound_off_attention"]) == 20


def test_message_clarity_needs_speech():
    assert scoring.analyze(clip())["scores"]["message_clarity"] is None
    assert scoring.analyze(clip(), speech_seconds={2, 3, 4})["scores"]["message_clarity"]["value"] >= 0


def test_short_clip_and_text_overload():
    assert scoring.analyze(clip(10))["facts"]["short_clip"] is True
    text = np.zeros(20)
    text[8:11] = 3.0
    result = scoring.analyze(clip(20, text_reading=text))
    assert result["facts"]["short_clip"] is False
    overload = [m for m in result["moments"] if m["kind"] == "text_overload"]
    assert len(overload) == 1 and 7 <= overload[0]["start"] <= 9


def test_library_baseline_gives_percentiles():
    from build_reference import build

    clips = [(clip(20, seed=i), None, set()) for i in range(30)]
    reference = build(clips, "test reels")
    assert reference["n_clips"] == 30 and "attention_index" in reference["networks"]
    result = scoring.analyze(clip(20, seed=99), reference=reference)
    assert result["baseline"] == "library"
    assert result["reference_label"] == "test reels"
    assert 0 <= result["scores"]["hook"]["percentile"] <= 100


def test_mismatched_lengths_are_truncated():
    nets = clip(20)
    nets["faces"] = nets["faces"][:18]
    assert scoring.analyze(nets)["seconds"] == 18
