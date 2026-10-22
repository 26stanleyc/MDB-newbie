"""Build per-hold grasp data for a whole wall: relief (depth) → graspability.

For every hold: run the high-res per-hold relief model, compute a grasp map + best
grasp point, save the arrays + a grasp.json (grasp point in normalized image
coords, per hold), and render a wall overlay marking where to grab each hold.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/build_grasp.py --stems 0075 0917
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.grasp import best_grasp_point, grasp_map  # noqa: E402
from pipeline.hold_relief import hold_relief  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402

OUT = os.path.join(BACKEND, "artifacts", "grasp")


def process_scan(sample, out_dir):
    bgr = cv2.imread(sample.path)
    H, W = bgr.shape[:2]
    overlay = bgr.copy()
    records, arrays = [], {}

    for i, inst in enumerate(sample.instances):
        res = hold_relief(bgr, inst.points)
        relief, mask = res["relief"], res["mask"]
        cx0, cy0, _, _ = res["bbox"]
        g = grasp_map(relief, mask)
        pt = best_grasp_point(g)

        hid = f"h{i}"
        arrays[f"{hid}__relief"] = relief.astype(np.float32)
        arrays[f"{hid}__grasp"] = g.astype(np.float32)

        poly = inst.points.astype(np.int32)
        label = "hold" if inst.label == 1 else "volume"
        rec = {"hold_id": hid, "label": label,
               "relief_max_disp": float(relief.max()),
               "grasp_point_norm": None}
        if pt is not None:
            gx, gy = pt[0] + cx0, pt[1] + cy0
            rec["grasp_point_norm"] = [float(gx / W), float(gy / H)]
            # draw: hold outline + grasp marker
            cv2.polylines(overlay, [poly], True, (255, 255, 255), 1)
            cv2.drawMarker(overlay, (gx, gy), (0, 255, 255), cv2.MARKER_CROSS, 18, 2)
            cv2.circle(overlay, (gx, gy), 8, (0, 255, 255), 2)
        records.append(rec)

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "grasp.json"), "w") as f:
        json.dump({"scan": os.path.basename(sample.path), "holds": records}, f, indent=2)
    np.savez_compressed(os.path.join(out_dir, "grasp_arrays.npz"), **arrays)
    cv2.imwrite(os.path.join(OUT, f"{os.path.splitext(os.path.basename(sample.path))[0]}_wall_grasp.png"), overlay)
    return len(records), sum(1 for r in records if r["grasp_point_norm"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stems", nargs="+", default=["0075", "0917"])
    ap.add_argument("--gyms", nargs="+", default=["bh", "sm", "bh-phone"])
    args = ap.parse_args()

    idx = {os.path.splitext(os.path.basename(s.path))[0]: s
           for s in load_via_index(os.path.join(ROOT, "data"), args.gyms)}
    for stem in args.stems:
        s = idx.get(stem)
        if s is None:
            print(f"  skip {stem}")
            continue
        n, g = process_scan(s, os.path.join(OUT, stem))
        print(f"  {stem}: {n} holds, {g} with grasp points -> {OUT}/{stem}_wall_grasp.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
