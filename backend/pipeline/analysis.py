"""Second processing phase: per-hold quality + grip point, and wall angles.

Runs after detection/colors (pipeline/scan.py), so the app shows results first and
this fills in a few seconds later (~5 s for 60 holds + ~4 s normals on MPS, after a
one-time model load).

Hold quality (0–1) is a HEURISTIC — there is no ground truth for it yet:
  - size: longest side in cm (metric scale from pipeline/scan.meters_per_pixel);
    a ~3 cm crimp scores 0, a ≥15 cm jug scores 1;
  - prominence: how far the hold stands out from the wall in a per-hold depth crop
    (Depth Anything V2, pipeline/hold_relief.py), relative to the bare wall's own
    depth noise in that crop — a scale-free signal-to-noise ratio.
  Volumes get a neutral 0.5 (they're used by their edges, not as a single grip).
Grip point: the best grasp location from pipeline/grasp.py (top edge / lip bias).

Wall angle: Marigold surface normals (pipeline/wall_normals.py), smoothed, sampled on
the bare wall around each hold. Normal frame (Marigold): x right, y up, z toward the
camera. With the phone's gravity (iOS DeviceMotion, CaptureMeta.gravity — device
frame x right, y up, z out of the screen, pointing down) the angle is absolute:
0 = vertical, + overhang, − slab. Without gravity (uploads) only angles relative to
the main wall are reported: photos are often shot from below, so an assumed-level
camera would mislabel overhangs as slabs.
"""

from __future__ import annotations

import cv2
import numpy as np

from .grasp import best_grasp_point, grasp_map
from .hold_relief import hold_relief

SIZE_CM_LO, SIZE_CM_HI = 3.0, 15.0
PROMINENCE_HALF = 3.0      # relief/noise ratio that scores 0.5
NORMAL_SMOOTH_SIGMA = 9.0
RING_PX = 12               # bare-wall ring around a hold for its local wall normal


def hold_quality(bgr: np.ndarray, polygon_px: np.ndarray, size_cm: float, kind: str) -> dict:
    """Quality score, prominence and grip point for one hold (full-res image coords)."""
    r = hold_relief(bgr, polygon_px)
    mask, relief = r["mask"], r["relief"]
    peak = float(np.percentile(relief[mask], 90)) if mask.any() else 0.0
    snr = peak / max(r["ring_noise"], 1e-6)
    prominence = snr / (snr + PROMINENCE_HALF)
    size = float(np.clip((size_cm - SIZE_CM_LO) / (SIZE_CM_HI - SIZE_CM_LO), 0, 1))
    quality = 0.5 if kind == "volume" else 0.5 * size + 0.5 * prominence

    grip = None
    pt = best_grasp_point(grasp_map(relief, mask))
    if pt is not None:
        x0, y0, _, _ = r["bbox"]
        H, W = bgr.shape[:2]
        grip = {"x": (x0 + pt[0]) / W, "y": (y0 + pt[1]) / H}
    return {"quality": round(float(quality), 3), "prominence": round(float(prominence), 3),
            "sizeCm": round(float(size_cm), 1), "gripPoint": grip}


def gravity_in_image(gravity: dict | None) -> np.ndarray | None:
    """Device gravity → image frame (x right, y up, z toward camera).

    The uploaded image is upright, so its 'down' is the in-plane part of gravity;
    only the camera's pitch (gravity's z) is taken from the reading. Assumes iOS
    (gravity points down) and a roughly level shot (no roll)."""
    if not gravity:
        return None
    g = np.array([gravity.get("x", 0.0), gravity.get("y", 0.0), gravity.get("z", 0.0)], float)
    if np.linalg.norm(g) < 1e-3:
        return None
    v = np.array([0.0, -np.hypot(g[0], g[1]), g[2]])
    return v / np.linalg.norm(v)


def tilt_deg(normal: np.ndarray, down: np.ndarray) -> float:
    """+ overhang / − slab vs vertical, for an outward (toward camera) normal."""
    n = normal / (np.linalg.norm(normal) + 1e-9)
    return float(np.degrees(np.arcsin(np.clip(n @ down, -1, 1))))


def wall_angles(normals: np.ndarray, hold_masks: dict[str, np.ndarray], gravity: dict | None) -> dict:
    """Per-hold local wall angle + scan summary from a raw Marigold normal map
    (H, W, 3) at the same resolution as the masks."""
    n = cv2.GaussianBlur(normals.astype(np.float32), (0, 0), NORMAL_SMOOTH_SIGMA)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    any_hold = np.any(list(hold_masks.values()), axis=0) if hold_masks else np.zeros(n.shape[:2], bool)
    wall = ~cv2.dilate(any_hold.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    main = np.median(n[wall], axis=0) if wall.any() else np.median(n.reshape(-1, 3), axis=0)

    down = gravity_in_image(gravity)
    ref = down if down is not None else np.array([0.0, -1.0, 0.0])  # only for relative angles
    main_tilt = tilt_deg(main, ref)
    kernel = np.ones((2 * RING_PX + 1, 2 * RING_PX + 1), np.uint8)

    per_hold = {}
    for hid, m in hold_masks.items():
        ring = cv2.dilate(m.astype(np.uint8), kernel).astype(bool) & wall
        local = n[ring].mean(axis=0) if ring.sum() >= 20 else n[m].mean(axis=0)
        t = tilt_deg(local, ref)
        per_hold[hid] = {
            "wallAngleDeg": round(t, 1) if down is not None else None,
            "relWallAngleDeg": round(t - main_tilt, 1),  # + = steeper than the main wall
        }
    rel = [v["relWallAngleDeg"] for v in per_hold.values()]
    return {
        "holds": per_hold,
        "wall": {
            "angleDeg": round(main_tilt, 1) if down is not None else None,
            "source": "gravity" if down is not None else "no_gravity",
            "relRangeDeg": [round(min(rel), 1), round(max(rel), 1)] if rel else None,
        },
    }
