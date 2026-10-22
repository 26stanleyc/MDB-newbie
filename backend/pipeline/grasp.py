"""Graspability from per-hold relief.

Goal: where on a hold can a hand pull? Graspable spots are protruding edges / lips
(an incut rim you can hook), biased toward the top of the hold (climbers pull down
on the highest positive edge). We score each pixel by a mix of:
  - relief height (how far it protrudes above the wall),
  - edge strength of the relief (lips/rims, where the surface rolls over),
  - a mild upper-bias (top edges are the usual grip).
Returns a normalized grasp heatmap (0-1, 0 outside the hold) and the best point.
"""

from __future__ import annotations

import cv2
import numpy as np

W_RELIEF = 0.5
W_EDGE = 0.5
UPPER_BIAS = 0.45   # preference for the top of the hold (where climbers pull)
SOLID_LO, SOLID_HI = 0.2, 0.5  # gate: ignore faint relief below this band


def grasp_map(relief: np.ndarray, mask: np.ndarray) -> np.ndarray:
    r = relief.copy()
    r[~mask] = 0.0
    if r.max() <= 1e-6:
        return np.zeros_like(r)
    rn = r / r.max()

    gx = cv2.Sobel(rn, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(rn, cv2.CV_32F, 0, 1, ksize=3)
    edge = np.sqrt(gx * gx + gy * gy)
    edge /= edge.max() + 1e-9

    h = r.shape[0]
    upper = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None] * np.ones((1, r.shape[1]), np.float32)
    upper = (1.0 - UPPER_BIAS) + UPPER_BIAS * upper

    # Only the solid protruding part is graspable — gate out faint relief so the
    # point doesn't snap to a weak edge far from the real hold body.
    solid = np.clip((rn - SOLID_LO) / (SOLID_HI - SOLID_LO), 0.0, 1.0)

    g = (W_RELIEF * rn + W_EDGE * edge) * upper * solid
    g[~mask] = 0.0
    g = cv2.GaussianBlur(g, (0, 0), 1.5)
    g[~mask] = 0.0
    if g.max() > 0:
        g /= g.max()
    return g


def best_grasp_point(grasp: np.ndarray) -> tuple[int, int] | None:
    """(x, y) of the strongest grasp location, or None."""
    if grasp.max() <= 0:
        return None
    y, x = np.unravel_index(int(np.argmax(grasp)), grasp.shape)
    return int(x), int(y)
