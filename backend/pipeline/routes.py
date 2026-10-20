"""M10 — route grouping by color.

Given detected holds, assign each a lighting/chalk-robust color and group holds
of the same color into routes (design doc §10 M10). Produces both a human color
label (the app's `Hold.color`) and a route grouping.

Robustness tricks:
  - work in CIELAB and compare mostly on chroma (a,b), so brightness/lighting
    matters less;
  - trim chalk (bright, low-chroma) and shadow (dark) pixels before taking the
    hold's median color;
  - achromatic holds (low chroma) are decided as black/grey/white by lightness.
"""

from __future__ import annotations

import cv2
import numpy as np

# Named gym palette (matches the app's route colors). Hex -> reference Lab below.
PALETTE_HEX = {
    "red": "#E23B2E", "orange": "#F07D1A", "yellow": "#F2C318",
    "green": "#36B24A", "teal": "#17A2A2", "blue": "#2E7CE4",
    "purple": "#8B46D4", "pink": "#E8559E", "brown": "#8A5A2B",
}
ACHROMATIC = {"black": 25.0, "grey": 130.0, "white": 235.0}  # name -> target L (0-255)

CHROMA_ACHROMATIC_MAX = 14.0  # below this chroma, treat as black/grey/white


def _hex_to_lab(h: str) -> np.ndarray:
    r = int(h[1:3], 16); g = int(h[3:5], 16); b = int(h[5:7], 16)
    bgr = np.array([[[b, g, r]]], np.uint8)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)


_PALETTE_LAB = {name: _hex_to_lab(h) for name, h in PALETTE_HEX.items()}


def hold_color_lab(
    image_bgr: np.ndarray, mask: np.ndarray, lab: np.ndarray | None = None
) -> np.ndarray | None:
    """Robust median Lab of a hold. Returns [L,a,b] (0-255).

    Pass a precomputed `lab` (full-image CIELAB) to avoid re-converting per hold.
    Steps: erode the mask to avoid edge/background bleed; trim chalk/shadow by
    lightness; take the median.
    """
    m = mask.astype(np.uint8)
    # Erode proportional to hold size, but never wipe small holds.
    area = int(m.sum())
    k = max(1, int(round(np.sqrt(area) * 0.15)))
    eroded = cv2.erode(m, np.ones((k, k), np.uint8))
    use = eroded if int(eroded.sum()) >= 20 else m

    if lab is None:
        lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    px = lab[use.astype(bool)].astype(np.float32)
    if px.size == 0:
        return None

    L = px[:, 0]
    lo, hi = np.percentile(L, [15, 90])
    keep = (L >= lo) & (L <= hi)
    if keep.sum() >= 10:
        px = px[keep]
    return np.median(px, axis=0)


def name_color(lab: np.ndarray) -> str:
    """Nearest named gym color, chroma-first with achromatic fallback."""
    L, a, b = lab
    chroma = float(np.hypot(a - 128, b - 128))
    if chroma < CHROMA_ACHROMATIC_MAX:
        return min(ACHROMATIC, key=lambda n: abs(L - ACHROMATIC[n]))
    # chromatic: hue angle dominates (separates similar colors better), with a
    # smaller penalty on chroma magnitude and lightness.
    hue = np.arctan2(b - 128, a - 128)
    best, bestd = None, 1e9
    for name, ref in _PALETTE_LAB.items():
        rhue = np.arctan2(ref[2] - 128, ref[1] - 128)
        dh = abs(np.arctan2(np.sin(hue - rhue), np.cos(hue - rhue)))  # circular
        rchroma = np.hypot(ref[1] - 128, ref[2] - 128)
        d = 3.0 * dh + 0.03 * abs(chroma - rchroma) + 0.01 * abs(L - ref[0])
        if d < bestd:
            best, bestd = name, d
    return best


def group_by_name(labs: list[np.ndarray]) -> tuple[list[str], list[int]]:
    """Assign each hold a color name; routes = holds sharing a name."""
    names = [name_color(l) for l in labs]
    order = {n: i for i, n in enumerate(dict.fromkeys(names))}
    return names, [order[n] for n in names]


def classify_and_group(
    labs: list[np.ndarray], threshold: float = 20.0
) -> tuple[list[str], list[int]]:
    """Cluster a wall's holds by appearance, name each cluster by its centroid
    (steadier than per-hold naming), then merge same-named clusters into
    color-routes (the app's one-route-per-color model). Returns (names, route_ids).

    Falls back to per-hold naming for <3 holds.
    """
    from sklearn.cluster import AgglomerativeClustering

    if len(labs) < 3:
        return group_by_name(labs)

    arr = np.asarray(labs, dtype=np.float32)
    feat = np.stack([(arr[:, 0] - 128) * 0.4, arr[:, 1] - 128, arr[:, 2] - 128], axis=1)
    clusters = AgglomerativeClustering(
        n_clusters=None, distance_threshold=threshold, linkage="average"
    ).fit_predict(feat)

    # Name each cluster from its mean color.
    cluster_name = {
        c: name_color(arr[clusters == c].mean(axis=0)) for c in set(clusters)
    }
    names = [cluster_name[c] for c in clusters]
    order = {n: i for i, n in enumerate(dict.fromkeys(names))}
    return names, [order[n] for n in names]
