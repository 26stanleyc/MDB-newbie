"""M11 geometry pipeline — everything except the DA3 inference (which is GPU).

Input: an RGB image, a metric depth map (meters, from DA3 — see depth_model.py),
per-hold masks, camera metadata (CaptureMeta), and the gravity vector *in camera
frame*. Output: a WallSurface + one HoldDepthRecord per hold, plus heavy arrays.

Camera frame convention (OpenCV): +x right, +y down, +z forward (into the scene).
All math here is CPU/numpy and is validated on synthetic scenes with known answers
(scripts/validate_depth_synthetic.py).
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict

import numpy as np

from .depth_schema import (
    HEIGHT_MAP_MM_PER_CELL,
    LOWCONF_MAX_PLANE_NOISE_M,
    LOWCONF_MIN_MASK_PX,
    HoldDepthRecord,
    HoldSummary,
    Intrinsics,
    WallSurface,
)

# Full-frame sensor width (mm) used for the 35mm-equivalent -> pixels conversion.
SENSOR_35MM_WIDTH = 36.0
# Fallback focal length (35mm-equiv, mm) when EXIF is missing — modern iPhone main.
DEFAULT_FOCAL_35MM = 26.0


# --- Intrinsics --------------------------------------------------------------

def compute_intrinsics(width: int, height: int, focal35: float | None) -> Intrinsics:
    long_side = max(width, height)
    if focal35 and focal35 > 0:
        fpx = focal35 / SENSOR_35MM_WIDTH * long_side
        source = "exif"
    else:
        fpx = DEFAULT_FOCAL_35MM / SENSOR_35MM_WIDTH * long_side
        source = "default"
    return Intrinsics(fx=fpx, fy=fpx, cx=width / 2.0, cy=height / 2.0, source=source)


def intrinsics_from_focal_px(width: int, height: int, fpx: float, source: str) -> Intrinsics:
    return Intrinsics(fx=fpx, fy=fpx, cx=width / 2.0, cy=height / 2.0, source=source)


def backproject(depth_m: np.ndarray, intr: Intrinsics) -> np.ndarray:
    """Depth map (H,W meters) -> 3D points (H,W,3) in camera frame."""
    h, w = depth_m.shape
    us, vs = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    x = (us - intr.cx) * depth_m / intr.fx
    y = (vs - intr.cy) * depth_m / intr.fy
    return np.stack([x, y, depth_m], axis=-1)


# --- Wall plane --------------------------------------------------------------

def _fit_plane_svd(pts: np.ndarray) -> tuple[np.ndarray, float]:
    c = pts.mean(0)
    _, _, vh = np.linalg.svd(pts - c)
    n = vh[-1]
    n = n / (np.linalg.norm(n) + 1e-9)
    return n, float(-n @ c)


def fit_wall_plane(
    points: np.ndarray, wall_mask: np.ndarray, iters: int = 300, thresh: float = 0.01
) -> tuple[np.ndarray, float, float]:
    """RANSAC-fit the dominant bare-wall plane. Returns (normal, d, residual_std).

    `wall_mask` is True on bare-wall pixels (holds masked out). Normal is oriented
    to point toward the camera (negative z).
    """
    pts = points[wall_mask & np.isfinite(points[..., 2])]
    if len(pts) > 20000:
        pts = pts[np.random.default_rng(0).choice(len(pts), 20000, replace=False)]
    rng = np.random.default_rng(0)
    best_in, best = None, None
    for _ in range(iters):
        idx = rng.choice(len(pts), 3, replace=False)
        p = pts[idx]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        nn = np.linalg.norm(n)
        if nn < 1e-9:
            continue
        n = n / nn
        d = -n @ p[0]
        dist = np.abs(pts @ n + d)
        inliers = dist < thresh
        if best_in is None or inliers.sum() > best_in.sum():
            best_in, best = inliers, (n, d)
    # refit on inliers
    n, d = _fit_plane_svd(pts[best_in])
    if n[2] > 0:  # orient toward camera
        n, d = -n, -d
    resid = np.abs(pts[best_in] @ n + d)
    return n, d, float(resid.std())


def wall_angle_deg(normal: np.ndarray, gravity_cam: np.ndarray) -> float:
    """Signed tilt from vertical: + overhang (normal leans downward), - slab."""
    g = gravity_cam / (np.linalg.norm(gravity_cam) + 1e-9)
    return float(np.degrees(np.arcsin(np.clip(normal @ g, -1, 1))))


# --- Per-hold frame + records ------------------------------------------------

def _hold_frame(origin, normal, gravity_cam):
    out = normal / (np.linalg.norm(normal) + 1e-9)
    g = gravity_cam / (np.linalg.norm(gravity_cam) + 1e-9)
    g_plane = g - (g @ out) * out
    up = -g_plane / (np.linalg.norm(g_plane) + 1e-9)   # opposite gravity, along wall
    right = np.cross(up, out)
    right /= np.linalg.norm(right) + 1e-9
    return np.stack([right, up, out])  # rows: x',y',z'


def _summary_and_arrays(local_mm: np.ndarray, colors: np.ndarray, mm_per_cell: float):
    """local_mm: (N,3) points in hold frame, millimeters (z'=protrusion)."""
    x, y, z = local_mm[:, 0], local_mm[:, 1], local_mm[:, 2]
    xmin, xmax, ymin, ymax = x.min(), x.max(), y.min(), y.max()
    nx = max(1, int(np.ceil((xmax - xmin) / mm_per_cell)))
    ny = max(1, int(np.ceil((ymax - ymin) / mm_per_cell)))
    ix = np.clip(((x - xmin) / mm_per_cell).astype(int), 0, nx - 1)
    iy = np.clip(((y - ymin) / mm_per_cell).astype(int), 0, ny - 1)
    # front surface = max protrusion per cell (vectorized scatter-max)
    flat = np.full(ny * nx, -np.inf, np.float32)
    np.maximum.at(flat, iy * nx + ix, z.astype(np.float32))
    height = flat.reshape(ny, nx)
    height[np.isneginf(height)] = np.nan

    valid = np.isfinite(height)
    prot = np.where(valid, np.maximum(height, 0), 0.0)
    cell_area = mm_per_cell * mm_per_cell
    # normals from height gradient (hold frame); gradient needs >=2 cells per axis
    if height.shape[0] >= 2 and height.shape[1] >= 2:
        gy, gx = np.gradient(np.nan_to_num(height, nan=0.0))
        nrm = np.stack([-gx, -gy, np.ones_like(height)], -1)
    else:
        nrm = np.zeros((*height.shape, 3), np.float32)
        nrm[..., 2] = 1.0
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-9
    mean_n = nrm[valid].mean(0) if valid.any() else np.array([0, 0, 1.0])
    mean_n /= np.linalg.norm(mean_n) + 1e-9

    summary = HoldSummary(
        max_protrusion_mm=float(np.nanmax(height)) if valid.any() else 0.0,
        mean_protrusion_mm=float(prot[valid].mean()) if valid.any() else 0.0,
        footprint_w_mm=float(xmax - xmin),
        footprint_h_mm=float(ymax - ymin),
        volume_mm3=float(prot[valid].sum() * cell_area),
        facing_azimuth_deg=float(np.degrees(np.arctan2(mean_n[1], mean_n[0]))),
        facing_elevation_deg=float(np.degrees(np.arcsin(np.clip(mean_n[2], -1, 1)))),
    )
    cloud = np.concatenate([local_mm, colors], axis=1) if colors is not None else local_mm
    if len(cloud) > 6000:  # cap point-cloud size for storage/speed
        idx = np.random.default_rng(0).choice(len(cloud), 6000, replace=False)
        cloud = cloud[idx]
    return summary, height, nrm.astype(np.float32), cloud.astype(np.float32)


def _confidence(mask_px, plane_noise, intr_source, gravity_source):
    flags = []
    a_mask = min(1.0, mask_px / 2000.0)
    if mask_px < LOWCONF_MIN_MASK_PX:
        flags.append("small_mask")
    a_noise = float(np.clip(1.0 - plane_noise / (LOWCONF_MAX_PLANE_NOISE_M * 2), 0, 1))
    if plane_noise > LOWCONF_MAX_PLANE_NOISE_M:
        flags.append("noisy_wall")
    a_intr = 1.0 if intr_source == "exif" else 0.6
    if intr_source != "exif":
        flags.append("assumed_intrinsics")
    a_grav = 1.0 if gravity_source == "measured" else 0.7
    if gravity_source != "measured":
        flags.append("assumed_gravity")
    conf = float(a_mask * a_noise * a_intr * a_grav)
    return conf, flags


def process_hold(
    points, colors, mask, wall_normal, wall_d, gravity_cam, plane_noise,
    intr: Intrinsics, gravity_source, hold_id, label, color, model_version,
    mm_per_cell=HEIGHT_MAP_MM_PER_CELL,
):
    full_mask = mask.astype(bool)
    ys, xs = np.where(full_mask)
    if len(xs) < 10:
        return None, None
    # Crop to the hold's bounding box so cost scales with the hold, not the image.
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub_pts = points[y0:y1, x0:x1]
    sub_mask = full_mask[y0:y1, x0:x1] & np.isfinite(sub_pts[..., 2])
    pts = sub_pts[sub_mask]
    cols = colors[y0:y1, x0:x1][sub_mask] if colors is not None else None
    if len(pts) < 10:
        return None, None

    # footprint centroid projected onto the wall plane → hold-frame origin
    centroid = pts.mean(0)
    origin = centroid - (wall_normal @ centroid + wall_d) * wall_normal
    R = _hold_frame(origin, wall_normal, gravity_cam)
    local_m = (pts - origin) @ R.T          # columns x',y',z' (meters)
    local_mm = local_m * 1000.0

    summary, height, normals, cloud = _summary_and_arrays(local_mm, cols, mm_per_cell)
    conf, flags = _confidence(len(pts), plane_noise, intr.source, gravity_source)

    h, w = mask.shape
    cy, cx = ys.mean(), xs.mean()
    rec = HoldDepthRecord(
        hold_id=hold_id, label=label, color=color,
        position_norm=[float(cx / w), float(cy / h)],
        wall_angle_deg=wall_angle_deg(wall_normal, gravity_cam),
        mm_per_cell=mm_per_cell, summary=summary, confidence=conf, flags=flags,
        intrinsics_source=intr.source, gravity_source=gravity_source,
        model_version=model_version,
    )
    arrays = {"height_map": height, "normal_map": normals, "point_cloud": cloud}
    return rec, arrays


def process_scan(image_rgb, depth_m, holds, width, height, gravity_cam,
                 focal35=None, focal_px=None, gravity_source="measured",
                 model_version="unknown"):
    """Full per-scan geometry pass.

    holds: list of {id, mask (H,W bool), label, color}. Provide `focal_px` (e.g.
    the exact value Colab used for the metric conversion) or `focal35`. Returns
    (WallSurface, [HoldDepthRecord], {hold_id: arrays}).
    """
    if focal_px is not None:
        intr = intrinsics_from_focal_px(width, height, focal_px, "exif")
    else:
        intr = compute_intrinsics(width, height, focal35)
    points = backproject(depth_m, intr)
    colors = image_rgb

    any_hold = np.zeros(depth_m.shape, bool)
    for h in holds:
        any_hold |= h["mask"].astype(bool)
    wall_normal, wall_d, noise = fit_wall_plane(points, ~any_hold)

    wall = WallSurface(
        normal=[float(x) for x in wall_normal],
        distance_m=float(np.nanmedian(depth_m[~any_hold])),
        angle_deg=wall_angle_deg(wall_normal, gravity_cam),
        plane_count=1,
        model_version=model_version,
    )

    records, arrays_by_hold = [], {}
    for h in holds:
        rec, arr = process_hold(
            points, colors, h["mask"], wall_normal, wall_d, gravity_cam, noise,
            intr, gravity_source, hold_id=h["id"], label=h.get("label", "hold"),
            color=h.get("color", "unknown"), model_version=model_version,
        )
        if rec is not None:
            records.append(rec)
            arrays_by_hold[h["id"]] = arr
    return wall, records, arrays_by_hold


def save_records(out_dir, scan_id, wall, records, arrays_by_hold) -> None:
    """Write records.json (metadata) + arrays.npz (height/normal/point-cloud)."""
    os.makedirs(out_dir, exist_ok=True)
    doc = {
        "scan_id": scan_id,
        "wall_surface": asdict(wall),
        "holds": [asdict(r) for r in records],
    }
    with open(os.path.join(out_dir, "records.json"), "w") as f:
        json.dump(doc, f, indent=2)
    flat = {}
    for hid, arr in arrays_by_hold.items():
        for k, v in arr.items():
            flat[f"{hid}__{k}"] = v
    np.savez_compressed(os.path.join(out_dir, "arrays.npz"), **flat)
