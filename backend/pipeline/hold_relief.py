"""Per-hold surface relief from a high-res crop (local, MPS).

Full-image DA3 is too coarse for individual holds, so we bind a second model:
Depth Anything V2 (small) run on a padded full-res crop around each hold. The
surrounding bare-wall ring is fit to a plane in disparity and subtracted, leaving
the hold's relief above the wall — rich enough to find graspable structure.

Disparity (inverse depth) is relative, not metric; for *graspability* the relative
shape within a hold is what matters. Absolute mm would need the DA3-metric fusion.
"""

from __future__ import annotations

import cv2
import numpy as np

_PIPE = None
_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"


def _pipe():
    global _PIPE
    if _PIPE is None:
        import torch
        from transformers import pipeline
        dev = "mps" if torch.backends.mps.is_available() else (
            "cuda" if torch.cuda.is_available() else "cpu")
        _PIPE = pipeline("depth-estimation", model=_MODEL, device=dev)
    return _PIPE


def _disparity(crop_bgr: np.ndarray) -> np.ndarray:
    from PIL import Image
    out = _pipe()(Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)))
    pd = out["predicted_depth"]
    d = pd.squeeze().detach().cpu().numpy() if hasattr(pd, "detach") else np.asarray(pd)
    return cv2.resize(d.astype(np.float32), (crop_bgr.shape[1], crop_bgr.shape[0]))


def hold_relief(bgr: np.ndarray, polygon: np.ndarray, pad: float = 0.6) -> dict:
    """Return per-hold relief in a crop. Keys: crop, mask, relief(>=0), bbox."""
    H, W = bgr.shape[:2]
    xs, ys = polygon[:, 0], polygon[:, 1]
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    p = int(pad * max(x1 - x0, y1 - y0, 1))
    cx0, cy0 = max(0, x0 - p), max(0, y0 - p)
    cx1, cy1 = min(W, x1 + p), min(H, y1 + p)
    crop = bgr[cy0:cy1, cx0:cx1]

    disp = _disparity(crop)
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [polygon.astype(np.int32)], 1)
    mc = m[cy0:cy1, cx0:cx1].astype(bool)

    # Fit the bare-wall ring (outside the hold) to a plane in disparity vs (x,y),
    # so the wall's own tilt/gradient across the crop is removed.
    gy, gx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]].astype(np.float32)
    ring = ~mc
    if ring.sum() < 10:
        plane = np.full_like(disp, np.median(disp))
    else:
        A = np.stack([gx[ring], gy[ring], np.ones(int(ring.sum()), np.float32)], 1)
        coef, *_ = np.linalg.lstsq(A, disp[ring], rcond=None)
        plane = coef[0] * gx + coef[1] * gy + coef[2]

    relief = disp - plane          # >0 where closer than wall → protruding
    relief[~mc] = 0.0
    relief = np.clip(relief, 0, None)
    return {"crop": crop, "mask": mc, "relief": relief, "bbox": (cx0, cy0, cx1, cy1)}
