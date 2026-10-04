"""Reduce TRIBE v2's 20,484 cortical predictions to a few named brain systems.

TRIBE v2 predicts activity on the fsaverage5 surface: 10,242 vertices per hemisphere,
left first. We average the vertices of each system per second using the HCP-MMP1
(Glasser 2016) parcellation that tribev2 itself ships helpers for.

The area lists are a coarse, literature-based grouping chosen for the insights Motion
shows. They are an approximation, not a validated mapping, and can be tuned here
without touching anything else.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

N_VERTICES = 20484
HEMI_SIZE = N_VERTICES // 2

# system -> (hemisphere, HCP-MMP1 area names)
NETWORKS: dict[str, tuple[str, list[str]]] = {
    # How much is visually happening: contrast, edges, cuts.
    "early_visual": ("both", ["V1", "V2", "V3", "V4"]),
    # Movement on screen.
    "visual_motion": ("both", ["MT", "MST", "FST", "V4t"]),
    # Faces and people (fusiform face complex + posterior STS).
    "faces": ("both", ["FFC", "STSdp", "STSvp"]),
    # Places and scenery (parahippocampal areas, roughly the PPA).
    "scenes": ("both", ["PHA1", "PHA2", "PHA3"]),
    # Reading on-screen text (left ventral occipitotemporal, near the visual word form area).
    "text_reading": ("left", ["PH", "TE2p", "VVC"]),
    # Sound: music, voice, effects.
    "auditory": ("both", ["A1", "LBelt", "MBelt", "PBelt", "RI", "A4", "A5"]),
    # Understanding words (left-lateralised language network).
    "language": ("left", ["44", "45", "55b", "STSda", "STSva", "TE1a", "PSL", "SFL"]),
    # Focused, external attention (frontal eye fields + intraparietal sulcus).
    "attention": ("both", ["FEF", "PEF", "LIPv", "LIPd", "VIP", "IP0", "IP1", "IP2", "7PC", "7AL", "MIP"]),
    # Thinking about people, intentions, stories, emotions (TPJ + medial prefrontal).
    "social": ("both", ["TPOJ1", "TPOJ2", "TPOJ3", "PGi", "STV", "9m", "10r", "10v", "p32", "s32"]),
    # Inward, mind-wandering state (posterior medial default mode network).
    "default_mode": ("both", ["31pv", "31pd", "31a", "7m", "v23ab", "d23ab", "POS1", "RSC", "PGs"]),
}


def build_roi_map() -> dict[str, np.ndarray]:
    """Vertex indices per system, using tribev2's HCP-MMP1 helper (downloads the atlas once)."""
    from tribev2.utils import get_hcp_roi_indices

    return {
        name: np.unique(get_hcp_roi_indices(areas, hemi=hemi, mesh="fsaverage5")).astype(np.int32)
        for name, (hemi, areas) in NETWORKS.items()
    }


def load_roi_map(path: Path) -> dict[str, np.ndarray]:
    """Loads the cached vertex map, building and saving it on first use."""
    if path.exists():
        with np.load(path) as data:
            roi_map = {name: data[name] for name in data.files}
        if set(roi_map) == set(NETWORKS):
            return roi_map
    roi_map = build_roi_map()
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **roi_map)
    return roi_map


def reduce(preds: np.ndarray, roi_map: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """(seconds, 20484) predictions -> {system: (seconds,) mean activity}."""
    if preds.ndim != 2 or preds.shape[1] != N_VERTICES:
        raise ValueError(f"expected (n_seconds, {N_VERTICES}) predictions, got {preds.shape}")
    return {name: preds[:, idx].mean(axis=1) for name, idx in roi_map.items()}
