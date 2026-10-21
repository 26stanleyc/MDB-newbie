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

import json
import os
from collections import Counter

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


# --- Learned color naming (2026-10-20) -------------------------------------------
# Hand-set palette hues don't match what gym photos record (dim light; orange holds
# land at the palette's "red" hue), and dark holds lose so much chroma they read as
# black. So: normalize exposure per image, measure chroma *relative to lightness*,
# and name each hold by its nearest labeled examples (k-NN). The reference set is
# built from every labeled route (backend/eval/route_colors.json), so it improves as
# labeled data is added — no thresholds to retune. Cross-validated on training images
# (leave-one-image-out): route color accuracy 0.80 vs 0.41 for the palette rule.

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLOR_REFS_PATH = os.path.join(_BACKEND, "artifacts", "color_refs.npz")
COLOR_LABELS_PATH = os.path.join(_BACKEND, "eval", "route_colors.json")
HOLD_COLORS_PATH = os.path.join(_BACKEND, "eval", "hold_colors.json")  # per-hold labels, gyms without routes
APP_HOLD_COLORS = "app-hold-colors.json"  # in data/: colors climbers set in the app (scripts/export_feedback.py)
KNN_K = 7
L_WEIGHT = 0.5


def linear_exposure(img_bgr: np.ndarray, holds_mask: np.ndarray) -> np.ndarray:
    """Linear-light image scaled so the holds' bright end (p95 of max channel) = 0.8."""
    f = img_bgr.astype(np.float32) / 255.0
    lin = np.where(f <= 0.04045, f / 12.92, ((f + 0.055) / 1.055) ** 2.4)
    if holds_mask.any():
        p95 = np.percentile(lin[holds_mask].max(axis=1), 95)
        lin = lin * (0.8 / max(float(p95), 1e-4))
    return lin


def hold_lab(lin: np.ndarray, mask: np.ndarray) -> np.ndarray | None:
    """Robust hold color as float CIELAB (L 0–100): erode the edge, trim the
    darkest/brightest pixels (shadow/chalk), median, back to sRGB → Lab."""
    m = mask.astype(np.uint8)
    k = max(1, int(round(np.sqrt(m.sum()) * 0.15)))
    e = cv2.erode(m, np.ones((k, k), np.uint8)).astype(bool)
    px = lin[e if e.sum() >= 20 else mask.astype(bool)]
    if len(px) == 0:
        return None
    mx = px.max(axis=1)
    lo, hi = np.percentile(mx, [15, 90])
    sel = (mx >= lo) & (mx <= hi)
    if sel.sum() >= 10:
        px = px[sel]
    c = np.clip(np.median(px, axis=0), 0, 1)
    srgb = np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)
    return cv2.cvtColor(srgb[None, None].astype(np.float32), cv2.COLOR_BGR2LAB)[0, 0]


def color_features(lab: np.ndarray) -> np.ndarray:
    """Lightness (down-weighted) + chroma relative to lightness, so a dark red hold
    keeps its 'redness' instead of collapsing toward black."""
    L, a, b = lab
    s = max(float(L), 5.0) / 50.0
    return np.array([L * L_WEIGHT, a / s, b / s], np.float32)


class ColorNamer:
    """k-NN over labeled hold colors."""

    def __init__(self, feats: np.ndarray, names: np.ndarray, k: int = KNN_K):
        self.feats, self.names, self.k = feats, names, k

    def name(self, lab: np.ndarray) -> str:
        d = np.linalg.norm(self.feats - color_features(lab), axis=1)
        nearest = self.names[np.argsort(d)[: self.k]]
        return Counter(nearest.tolist()).most_common(1)[0][0]

    def save(self, path: str = COLOR_REFS_PATH) -> None:
        np.savez(path, feats=self.feats, names=self.names)

    @classmethod
    def load(cls, path: str = COLOR_REFS_PATH) -> "ColorNamer | None":
        if not os.path.exists(path):
            return None
        d = np.load(path)
        return cls(d["feats"], d["names"])

    @classmethod
    def from_samples(cls, samples, working_image, labels_path: str = COLOR_LABELS_PATH) -> "ColorNamer":
        """Build the reference set from labeled routes in `samples` (pipeline.holds.Sample)."""
        labels = json.load(open(labels_path))
        feats, names = [], []
        for s in samples:
            routes = labels.get(f"{s.gym}/{os.path.basename(s.path)}")
            if not routes:
                continue
            bgr = cv2.imread(s.path)
            img = working_image(bgr)
            scale = img.shape[1] / bgr.shape[1]
            masks = []
            for inst in s.instances:
                m = np.zeros(img.shape[:2], np.uint8)
                cv2.fillPoly(m, [np.round(inst.points * scale).astype(np.int32)], 1)
                masks.append(m.astype(bool))
            lin = linear_exposure(img, np.any(masks, axis=0))
            for inst, m in zip(s.instances, masks):
                if inst.route_id in routes and m.any():
                    lab = hold_lab(lin, m)
                    if lab is not None:
                        feats.append(color_features(lab))
                        names.append(routes[inst.route_id][0])  # first = best-guess name
        return cls(np.array(feats, np.float32), np.array(names))

    def merged(self, other: "ColorNamer") -> "ColorNamer":
        return ColorNamer(np.concatenate([self.feats, other.feats]), np.concatenate([self.names, other.names]), self.k)

    @classmethod
    def from_hold_labels(cls, data_dir: str, working_image, keep=lambda key: True,
                         path: str = HOLD_COLORS_PATH) -> "ColorNamer":
        """Reference set from per-hold color labels (backend/eval/hold_colors.json)."""
        feats, names = [], []
        for _key, f, name in hold_label_features(data_dir, working_image, keep, path):
            feats.append(f)
            names.append(name)
        return cls(np.array(feats, np.float32).reshape(-1, 3), np.array(names))


def hold_label_features(data_dir: str, working_image, keep=lambda key: True, path: str = HOLD_COLORS_PATH):
    """Yield (image key, color feature, labeled name) for every labeled hold in
    hold_colors.json whose image key ("<gym>/<file>") passes `keep`. Exposure is
    normalized over all listed holds of the photo, as at inference."""
    if not os.path.exists(path):
        return
    for key, holds in json.load(open(path)).items():
        if key.startswith("_") or not keep(key) or not any(h["color"] for h in holds):
            continue
        bgr = cv2.imread(os.path.join(data_dir, key))
        if bgr is None:
            continue
        img = working_image(bgr)
        H, W = img.shape[:2]
        masks = []
        for h in holds:
            m = np.zeros((H, W), np.uint8)
            cv2.fillPoly(m, [np.round(np.array(h["polygon"]) * [W, H]).astype(np.int32)], 1)
            masks.append(m.astype(bool))
        lin = linear_exposure(img, np.any(masks, axis=0))
        for h, m in zip(holds, masks):
            if h["color"] and m.any():
                lab = hold_lab(lin, m)
                if lab is not None:
                    yield key, color_features(lab), h["color"]

