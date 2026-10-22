"""Fused, slope-aware per-hold depth (NEW pipeline — the relative one in
hold_relief.py / grasp.py / aggregate_depth.py is kept for comparison).

Two upgrades over the relative pipeline:

1. METRIC FUSION. DA3METRIC gives a near-flat but globally-consistent wall distance
   (~the whole wall at one depth); DA V2 gives detailed-but-relative per-crop
   disparity. We anchor each hold's local wall distance Z0 from DA3, then map DA V2
   disparity v to metric via an inverse-depth model anchored at the wall:
       Z = Z0 * v_wall / v        (v_wall = ring-median disparity)
   So every hold is placed at its real wall distance → holds are comparable on one
   metric scale (not self-normalized).

2. SLOPE AWARENESS. We back-project the crop to 3D and fit the LOCAL wall plane from
   the surrounding bare-wall ring, then measure protrusion along that plane's NORMAL —
   so protrusion is "out of the wall" even where the panel is angled/overhanging,
   not a flat-2D assumption.

Approximations (documented): DA V2 disparity is affine-invariant; we ignore its shift
and assume inverse-depth proportionality anchored at the wall. Absolute mm are
therefore approximate, but cross-hold comparability + slope handling hold. With
EXIF + gravity (real app) the anchor tightens further.
"""

from __future__ import annotations

import cv2
import numpy as np

from .depth import _fit_plane_svd  # local-plane SVD fit
from .hold_relief import _disparity  # DA V2 disparity on a crop


def fused_hold(bgr, polygon, Zda3_full, focal_px, pad: float = 0.6) -> dict:
    """Return per-hold metric, slope-aware protrusion (mm) along the wall normal.

    Keys: prot_mm (crop-sized, 0 outside hold), mask, bbox, wall_normal, tilt_deg,
    wall_dist_m.
    """
    H, W = bgr.shape[:2]
    cxf, cyf = W / 2.0, H / 2.0
    xs, ys = polygon[:, 0], polygon[:, 1]
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    p = int(pad * max(x1 - x0, y1 - y0, 1))
    cx0, cy0 = max(0, x0 - p), max(0, y0 - p)
    cx1, cy1 = min(W, x1 + p), min(H, y1 + p)

    crop = bgr[cy0:cy1, cx0:cx1]
    v = _disparity(crop)                     # DA V2 disparity (relative), high-res
    v = np.maximum(v, 1e-3)
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [polygon.astype(np.int32)], 1)
    mask = m[cy0:cy1, cx0:cx1].astype(bool)
    ring = ~mask
    if ring.sum() < 20 or mask.sum() < 8:
        return {"prot_mm": np.zeros_like(v), "mask": mask, "bbox": (cx0, cy0, cx1, cy1),
                "wall_normal": np.array([0, 0, -1.0]), "tilt_deg": 0.0, "wall_dist_m": 0.0}

    # Metric anchor from DA3 (local wall distance) + inverse-depth model.
    Zda3_crop = Zda3_full[cy0:cy1, cx0:cx1]
    Z0 = float(np.median(Zda3_crop[ring]))
    v_wall = float(np.median(v[ring]))
    Zc = Z0 * v_wall / v                      # metric depth per crop pixel (m)

    # Back-project to 3D in full-image pixel coords (so intrinsics are consistent).
    jj, ii = np.meshgrid(np.arange(cx0, cx1, dtype=np.float32),
                         np.arange(cy0, cy1, dtype=np.float32))
    X = (jj - cxf) * Zc / focal_px
    Y = (ii - cyf) * Zc / focal_px
    pts = np.stack([X, Y, Zc], axis=-1)       # (h, w, 3) camera frame, meters

    # Fit the LOCAL wall plane from the bare-wall ring, in 3D (handles slope).
    ring_pts = pts[ring]
    if len(ring_pts) > 4000:
        ring_pts = ring_pts[np.random.default_rng(0).choice(len(ring_pts), 4000, replace=False)]
    n, _ = _fit_plane_svd(ring_pts)
    if n[2] > 0:
        n = -n                                # orient toward camera
    centroid = ring_pts.mean(0)

    # Protrusion = distance along the wall normal, toward the camera (out of wall).
    prot = (pts.reshape(-1, 3) - centroid) @ n
    prot = prot.reshape(Zc.shape)
    prot_mm = np.clip(prot, 0, None) * 1000.0
    prot_mm[~mask] = 0.0

    # Local wall slope relative to facing the camera (true overhang needs gravity).
    tilt = float(np.degrees(np.arccos(np.clip(abs(n @ np.array([0, 0, -1.0])), 0, 1))))

    return {"prot_mm": prot_mm.astype(np.float32), "mask": mask,
            "bbox": (cx0, cy0, cx1, cy1), "wall_normal": n,
            "tilt_deg": tilt, "wall_dist_m": Z0}
