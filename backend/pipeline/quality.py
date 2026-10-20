"""M7 — image quality check.

Mirrors the app's `checkImageQuality` contract (design doc §7): returns ok, or a
failure with a reason in {blurry, too_dark, no_wall_detected} and a message.

Three signals, all classical CV (no GPU, no model):
  - blur:     variance of the Laplacian, computed on a resolution-normalized
              image so the threshold is comparable across phone/camera sizes.
  - exposure: mean luminance + fraction of near-black pixels.
  - is-a-wall: a gym wall is colorful (saturated holds) and textured (edges).
              Blank walls, sky, floors and faces score low on both.

Thresholds are tuned against the real labeled images; see
scripts/evaluate_quality.py for the validation that sets them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# Resolution to normalize to before blur scoring (long side, px).
NORM_LONG_SIDE = 1024

# Tuned on ../data (see evaluate_quality.py). Gyms are dimly lit, so real walls
# run dark (mean luma p1≈21) and sometimes soft (blur_var p1≈33) — thresholds sit
# just below those so genuine photos pass while degraded copies fall below.
BLUR_MIN_VAR = 28.0          # variance of Laplacian on the normalized image
DARK_MEAN_MAX = 18.0         # mean luma below this is too dark
DARK_FRACTION_MAX = 0.70     # ...or this fraction of pixels near-black
WALL_COLORFULNESS_MIN = 6.0
WALL_EDGE_DENSITY_MIN = 0.010

Reason = str  # "blurry" | "too_dark" | "no_wall_detected"


@dataclass
class QualityResult:
    ok: bool
    reason: Reason | None = None
    message: str | None = None
    metrics: dict = field(default_factory=dict)


def _normalize(bgr: np.ndarray) -> np.ndarray:
    h, w = bgr.shape[:2]
    scale = NORM_LONG_SIDE / max(h, w)
    if scale < 1.0:
        bgr = cv2.resize(bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return bgr


def _colorfulness(bgr: np.ndarray) -> float:
    """Hasler & Süsstrunk (2003) colorfulness metric."""
    b, g, r = cv2.split(bgr.astype("float32"))
    rg = r - g
    yb = 0.5 * (r + g) - b
    std = np.sqrt(rg.std() ** 2 + yb.std() ** 2)
    mean = np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    return float(std + 0.3 * mean)


def compute_metrics(bgr: np.ndarray) -> dict:
    img = _normalize(bgr)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    return {
        "blur_var": float(cv2.Laplacian(gray, cv2.CV_64F).var()),
        "mean_luma": float(gray.mean()),
        "dark_fraction": float((gray < 20).mean()),
        "colorfulness": _colorfulness(img),
        "edge_density": float((edges > 0).mean()),
    }


def check_image_quality(bgr: np.ndarray) -> QualityResult:
    """Grade a BGR image (as cv2.imread returns). Order: dark → blurry → wall."""
    m = compute_metrics(bgr)

    if m["mean_luma"] < DARK_MEAN_MAX or m["dark_fraction"] > DARK_FRACTION_MAX:
        return QualityResult(False, "too_dark",
                             "The photo is too dark. Add light or move closer to the wall.", m)

    if m["blur_var"] < BLUR_MIN_VAR:
        return QualityResult(False, "blurry",
                             "The photo looks blurry. Hold steady and try again.", m)

    if m["colorfulness"] < WALL_COLORFULNESS_MIN and m["edge_density"] < WALL_EDGE_DENSITY_MIN:
        return QualityResult(False, "no_wall_detected",
                             "We couldn't find a climbing wall. Frame the wall and its holds.", m)

    return QualityResult(True, metrics=m)


def check_image_file(path: str) -> QualityResult:
    bgr = cv2.imread(path)
    if bgr is None:
        return QualityResult(False, "no_wall_detected", "Could not read the image.", {})
    return check_image_quality(bgr)
