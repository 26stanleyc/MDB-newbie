"""Real 3D hold positions for a route, from the per-hold DA3 metric depth.

Why this and not the multi-view cloud: the DUSt3R reconstruction was of the 0310
wall, which has no route labels. The route-labeled images (0075, 0917, …) are other
walls. So for the planner we back-project each labeled hold's mask using the DA3
depth we already computed *for that same image* — giving true 3D positions (incl.
depth/overhang) on the wall that actually has the route.

Frame returned: x = right, y = up, z = toward camera (out of wall), meters.
(Image-up ≈ wall-up here — these dataset shots have no gravity vector; the real app
uses the captured gravity to get true vertical.)
"""

from __future__ import annotations

import cv2
import numpy as np

from .depth import backproject, intrinsics_from_focal_px
from .depth_model import load_depth_npz


def hold_positions_3d(image_bgr: np.ndarray, depth_npz_path: str, items):
    """items: list of (hold_id, polygon Nx2). Returns {hold_id: pos3d (m)}."""
    depth_m, meta = load_depth_npz(depth_npz_path)
    H, W = image_bgr.shape[:2]
    dh, dw = depth_m.shape
    scale = max(dh, dw) / max(H, W)                        # fix depth/focal resolution
    depth_full = cv2.resize((depth_m * scale).astype(np.float32), (W, H),
                            interpolation=cv2.INTER_LINEAR)
    intr = intrinsics_from_focal_px(W, H, meta["focal_px"], "exif")
    pts = backproject(depth_full, intr)                    # (H, W, 3) camera frame

    out = {}
    for hid, poly in items:
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [poly.astype(np.int32)], 1)
        mb = m.astype(bool) & np.isfinite(pts[..., 2])
        if mb.sum() >= 5:
            p = np.median(pts[mb], axis=0)
        else:
            cx, cy = int(poly[:, 0].mean()), int(poly[:, 1].mean())
            p = pts[cy, cx]
        # camera (x right, y down, z fwd) -> planner (x right, y up, z toward camera)
        out[hid] = np.array([p[0], -p[1], -p[2]], np.float32)
    return out
