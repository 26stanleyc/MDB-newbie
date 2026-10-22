"""Prototype M12: plan + visualize a personalized beta on a real labeled route.

Loads one route's holds (by VIA route_id) from a bh image, scales image coords to
meters (prototype: assume the image height spans ~ASSUMED_WALL_M; the real app uses
the multi-view metric reconstruction), runs the beta planner for a given body, and
draws the numbered hand/foot sequence (circle = hand, square = foot — app convention).

Compares two climbers (short vs tall) to show personalization changes the beta.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/plan_beta.py --stem 0075
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
from pipeline.geom3d import hold_positions_3d  # noqa: E402
from pipeline.hold_relief import hold_relief  # noqa: E402

DATA = os.path.join(ROOT, "data")
OUT = os.path.join(BACKEND, "artifacts", "beta")
DA3_DIR = os.path.join(BACKEND, "artifacts", "da3_depth")
ASSUMED_WALL_M = 4.5  # fallback scale if no DA3 depth: image height ~ this many meters


def load_route_holds(stem: str):
    """Return {route_id: [(hold_id, polygon)]} for a bh image with route labels."""
    routes = defaultdict(list)
    path = os.path.join(DATA, "bh", f"{stem}.jpg")
    for i, row in enumerate(csv.DictReader(open(os.path.join(DATA, "bh-annotation.csv")))):
        if row["filename"] != f"{stem}.jpg":
            continue
        try:
            sa = json.loads(row["region_shape_attributes"] or "{}")
            ra = json.loads(row["region_attributes"] or "{}")
        except json.JSONDecodeError:
            continue
        if sa.get("name") != "polygon":
            continue
        rid = ra.get("route_id", "")
        if rid in ("", None):
            continue
        poly = np.stack([sa["all_points_x"], sa["all_points_y"]], 1).astype(np.int32)
        routes[str(rid)].append((f"{stem}-{i}", poly))
    return path, routes


def draw_beta(img, holds_by_id, polys_by_id, steps, title):
    vis = img.copy()
    # dim non-route area slightly, outline route holds
    for hid, poly in polys_by_id.items():
        cv2.polylines(vis, [poly], True, (255, 255, 255), 2)
    # draw ordered connective path between successive hand moves
    hand_pts = [tuple(np.round(holds_by_id[s.hold_id]).astype(int)) for s in steps if s.limb in ("LH", "RH")]
    for a, b in zip(hand_pts, hand_pts[1:]):
        cv2.line(vis, a, b, (0, 220, 255), 2, cv2.LINE_AA)
    for s in steps:
        x, y = np.round(holds_by_id[s.hold_id]).astype(int)
        is_hand = s.limb in ("LH", "RH")
        color = (0, 200, 255) if is_hand else (120, 255, 120)
        if is_hand:
            cv2.circle(vis, (x, y), 18, color, 3)
        else:
            cv2.rectangle(vis, (x - 16, y - 16), (x + 16, y + 16), color, 3)
        cv2.putText(vis, f"{s.limb}{s.order}", (x - 20, y - 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
        cv2.putText(vis, f"{s.limb}{s.order}", (x - 20, y - 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    cv2.rectangle(vis, (0, 0), (vis.shape[1], 40), (0, 0, 0), -1)
    cv2.putText(vis, title, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    return vis


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="0075")
    ap.add_argument("--route", default=None, help="route_id; default = the one with most holds")
    ap.add_argument("--grasp", action="store_true", help="use real graspability (slow; runs DA V2 per hold)")
    args = ap.parse_args()

    path, routes = load_route_holds(args.stem)
    if not routes:
        print(f"no routed holds in {args.stem}")
        return 1
    rid = args.route or max(routes, key=lambda r: len(routes[r]))
    items = routes[rid]
    print(f"{args.stem} route {rid}: {len(items)} holds")

    img = cv2.imread(path)
    H, W = img.shape[:2]

    mpp = ASSUMED_WALL_M / H  # stable lateral/vertical scale from assumed wall height

    # Hybrid geometry: x,y from the image (reliable scale), z = DA3 depth as a
    # RELATIVE overhang offset (DA3's absolute metric is unreliable for these
    # EXIF-less shots, so we normalize its spread to a realistic ~0.3 m). This adds
    # true overhang-awareness while keeping the scale that personalizes well.
    npz = os.path.join(DA3_DIR, f"{args.stem}.npz")
    zrel = {}
    if os.path.exists(npz):
        pos3d = hold_positions_3d(img, npz, items)
        zraw = np.array([pos3d[hid][2] for hid, _ in items])
        spread = np.percentile(zraw, 95) - np.percentile(zraw, 5)
        zc = (zraw - np.median(zraw)) * (0.3 / (spread + 1e-6))  # -> ~±0.15 m
        zrel = {hid: float(zc[i]) for i, (hid, _) in enumerate(items)}
        print(f"using DA3 depth as relative overhang (z spread -> 0.3 m), {args.stem}.npz")
    else:
        print("no DA3 depth -> flat (z=0) positions")

    centers_px, holds, polys = {}, [], {}
    for hid, poly in items:
        cx, cy = poly[:, 0].mean(), poly[:, 1].mean()
        centers_px[hid] = np.array([cx, cy])
        polys[hid] = poly
        g = 0.6
        if args.grasp:
            r = hold_relief(img, poly)
            g = 0.4 + 0.6 * float(np.clip(r["relief"].max() / 0.03, 0, 1)) if r["relief"].max() > 0 else 0.4
        p = np.array([cx * mpp, (H - cy) * mpp, zrel.get(hid, 0.0)])
        holds.append(Hold(id=hid, pos=p, grasp=g))

    os.makedirs(OUT, exist_ok=True)
    panels = []
    for label, (ht, ws) in {"short (160cm / 158cm)": (160, 158),
                            "tall (190cm / 196cm)": (190, 196)}.items():
        steps, stab = plan_beta(holds, ht, ws)
        nmoves = len(steps)
        mean_stab = float(np.mean(stab)) if stab else 0.0
        hand_moves = sum(1 for s in steps if s.limb in ("LH", "RH"))
        print(f"  {label}: {nmoves} moves, {hand_moves} hand moves, "
              f"mean balance {mean_stab:.2f}")
        title = f"beta — {label} — {nmoves} moves — balance {mean_stab:.2f}"
        vis = draw_beta(img, centers_px, polys, steps, title)
        panels.append(vis)

    combo = np.hstack(panels)
    outp = os.path.join(OUT, f"{args.stem}_route{rid}_beta.png")
    cv2.imwrite(outp, combo)
    print(f"saved {outp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
