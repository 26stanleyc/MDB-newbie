"""Aggregate all per-hold relief maps into one wall-wide depth heatmap.

Each hold's high-res relief (Depth Anything V2 on a crop, wall subtracted) is pasted
back into its place on the full image, giving a single heatmap of the whole wall:
dark = wall/flat, bright = protruding (graspable) relief.

Note: DA V2 disparity is relative *per crop*, so cross-hold magnitudes aren't strictly
comparable — each hold is self-normalized so all holds are visible. This is a
qualitative depth view of the wall, not calibrated mm.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/aggregate_depth.py --stems 0075 0917
"""

from __future__ import annotations

import argparse
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.hold_relief import hold_relief  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402

OUT = os.path.join(BACKEND, "artifacts", "grasp")


def build(sample) -> tuple[np.ndarray, np.ndarray]:
    bgr = cv2.imread(sample.path)
    H, W = bgr.shape[:2]
    canvas = np.zeros((H, W), np.float32)

    for inst in sample.instances:
        res = hold_relief(bgr, inst.points)
        relief, mask = res["relief"], res["mask"]
        cx0, cy0, cx1, cy1 = res["bbox"]
        if relief.max() <= 1e-6:
            continue
        rn = (relief / relief.max()) * mask  # self-normalize per hold
        region = canvas[cy0:cy1, cx0:cx1]
        canvas[cy0:cy1, cx0:cx1] = np.maximum(region, rn)  # max handles overlaps

    heat = cv2.applyColorMap((np.clip(canvas, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    heat[canvas <= 0.02] = (20, 20, 20)  # keep bare wall dark
    overlay = cv2.addWeighted(bgr, 0.45, heat, 0.55, 0)
    overlay[canvas <= 0.02] = bgr[canvas <= 0.02]  # show the real wall where no holds
    return heat, overlay


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stems", nargs="+", default=["0075", "0917"])
    ap.add_argument("--gyms", nargs="+", default=["bh", "sm", "bh-phone"])
    args = ap.parse_args()

    idx = {os.path.splitext(os.path.basename(s.path))[0]: s
           for s in load_via_index(os.path.join(ROOT, "data"), args.gyms)}
    os.makedirs(OUT, exist_ok=True)
    for stem in args.stems:
        s = idx.get(stem)
        if s is None:
            print(f"  skip {stem}")
            continue
        heat, overlay = build(s)
        combo = np.hstack([overlay, heat])
        cv2.imwrite(os.path.join(OUT, f"{stem}_wall_depth.png"), combo)
        print(f"  {stem}: {len(s.instances)} holds -> {OUT}/{stem}_wall_depth.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
