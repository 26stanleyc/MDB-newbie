"""Metric scale anchor from average hold size.

A monocular/DA3 reconstruction is only correct up to a global scale. But we know
roughly how big a climbing hold is — so measuring a hold's size in the model's units
and dividing by an assumed real size gives the scale factor that turns the whole
thing into meters. This replaces the beta planner's assumed-wall-height guess with a
measured anchor.

Validation (no ground truth): after scaling, the route's vertical span should land in
a realistic bouldering range (~2–4 m), and a short vs tall climber should still get
different betas.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/scale_from_holds.py --stem 0075
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.beta import Hold, plan_beta  # noqa: E402
from pipeline.depth import backproject, intrinsics_from_focal_px  # noqa: E402
from pipeline.depth_model import load_depth_npz  # noqa: E402

DATA = os.path.join(ROOT, "data")
DA3_DIR = os.path.join(BACKEND, "artifacts", "da3_depth")

# Assumed average real hold LONGEST dimension (m). Gym holds vary widely; a mid hold's
# longest side is ~10–14 cm. Volumes are excluded from the median so they don't skew it.
ASSUMED_HOLD_LONGEST_M = 0.12


def route_holds(stem):
    routes = defaultdict(list)
    for i, row in enumerate(csv.DictReader(open(os.path.join(DATA, "bh-annotation.csv")))):
        if row["filename"] != f"{stem}.jpg":
            continue
        try:
            sa = json.loads(row["region_shape_attributes"] or "{}")
            ra = json.loads(row["region_attributes"] or "{}")
        except json.JSONDecodeError:
            continue
        if sa.get("name") != "polygon" or ra.get("route_id", "") in ("", None):
            continue
        poly = np.stack([sa["all_points_x"], sa["all_points_y"]], 1).astype(np.int32)
        routes[str(ra["route_id"])].append((f"{stem}-{i}", poly, ra.get("hold_type", "hold")))
    return routes


def longest_dim_m(pts3d):
    """Longest extent of a hold's 3D points (m), via PCA — robust to orientation."""
    if len(pts3d) < 5:
        return None
    c = pts3d - pts3d.mean(0)
    s = np.linalg.svd(c, compute_uv=False)
    # project onto principal axis, take full extent
    axis = np.linalg.svd(c, full_matrices=False)[2][0]
    proj = c @ axis
    return float(proj.max() - proj.min())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="0075")
    ap.add_argument("--assumed", type=float, default=ASSUMED_HOLD_LONGEST_M)
    args = ap.parse_args()

    routes = route_holds(args.stem)
    rid = max(routes, key=lambda r: len(routes[r]))
    items = routes[rid]

    img = cv2.imread(os.path.join(DATA, "bh", f"{args.stem}.jpg"))
    H, W = img.shape[:2]
    depth_m, meta = load_depth_npz(os.path.join(DA3_DIR, f"{args.stem}.npz"))
    dh, dw = depth_m.shape
    depth_full = cv2.resize((depth_m * (max(dh, dw) / max(H, W))).astype(np.float32), (W, H),
                            interpolation=cv2.INTER_LINEAR)
    intr = intrinsics_from_focal_px(W, H, meta["focal_px"], "exif")
    pts = backproject(depth_full, intr)

    # measure each hold's longest dim (DA3 meters); exclude volumes from the anchor
    sizes, centroids, labels = [], {}, {}
    for hid, poly, htype in items:
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [poly], 1)
        mb = m.astype(bool) & np.isfinite(pts[..., 2])
        hp = pts[mb]
        if len(hp) < 5:
            continue
        centroids[hid] = np.array([hp[:, 0].mean(), -hp[:, 1].mean(), -hp[:, 2].mean()])
        labels[hid] = htype
        d = longest_dim_m(hp)
        if d and htype != "volume":
            sizes.append(d)

    median_da3 = float(np.median(sizes))
    scale = args.assumed / median_da3
    print(f"{args.stem} route {rid}: {len(centroids)} holds")
    print(f"  median hold longest-dim in DA3 units: {median_da3*1000:.0f} mm")
    print(f"  assumed real hold longest-dim:         {args.assumed*1000:.0f} mm")
    print(f"  => metric SCALE factor: {scale:.2f}x\n")

    # apply scale, measure route span, re-run beta
    holds = [Hold(id=hid, pos=centroids[hid] * scale, grasp=0.6) for hid in centroids]
    ys = np.array([h.pos[1] for h in holds])
    xs = np.array([h.pos[0] for h in holds])
    print(f"  route vertical span (scaled): {ys.max()-ys.min():.2f} m  (realistic ~2–4 m?)")
    print(f"  route width (scaled):         {xs.max()-xs.min():.2f} m")

    for label, (ht, ws) in {"short 160cm": (160, 158), "tall 190cm": (190, 196)}.items():
        steps, stab = plan_beta(holds, ht, ws)
        hands = sum(1 for s in steps if s.limb in ("LH", "RH"))
        print(f"  {label}: {hands} hand moves, mean balance {np.mean(stab):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
