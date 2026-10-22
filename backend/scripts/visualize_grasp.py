"""Visualize per-hold relief + graspability to iterate the heuristics.

Builds a gallery: for the N largest holds on a wall, a row of
[photo crop + outline | relief heatmap | grasp heatmap on photo + best point].

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/visualize_grasp.py --stem 0917 --n 8
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

from pipeline.grasp import best_grasp_point, grasp_map  # noqa: E402
from pipeline.hold_relief import hold_relief  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402

OUT = os.path.join(BACKEND, "artifacts", "grasp")
ROW_H = 190


def heat(x, mask=None):
    v = x.copy()
    if v.max() > 0:
        v = v / v.max()
    img = cv2.applyColorMap((v * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    if mask is not None:
        img[~mask] = (30, 30, 30)
    return img


def fit_h(img, h=ROW_H):
    s = h / img.shape[0]
    return cv2.resize(img, (max(1, int(img.shape[1] * s)), h))


def label(img, text):
    cv2.rectangle(img, (0, 0), (img.shape[1], 18), (0, 0, 0), -1)
    cv2.putText(img, text, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="0917")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--gyms", nargs="+", default=["bh", "sm", "bh-phone"])
    args = ap.parse_args()

    idx = {os.path.splitext(os.path.basename(s.path))[0]: s
           for s in load_via_index(os.path.join(ROOT, "data"), args.gyms)}
    s = idx[args.stem]
    bgr = cv2.imread(s.path)

    # biggest holds first (most pixels → clearest relief)
    insts = sorted(s.instances, key=lambda i: cv2.contourArea(i.points.astype(np.int32)), reverse=True)
    insts = insts[: args.n]

    rows = []
    for k, inst in enumerate(insts):
        res = hold_relief(bgr, inst.points)
        crop, mask, relief = res["crop"], res["mask"], res["relief"]
        cx0, cy0, _, _ = res["bbox"]

        outlined = crop.copy()
        poly = inst.points.astype(np.int32) - [cx0, cy0]
        cv2.polylines(outlined, [poly], True, (0, 255, 0), 2)

        relief_vis = heat(relief, mask)

        g = grasp_map(relief, mask)
        gv = heat(g, mask)
        grasp_on = cv2.addWeighted(crop, 0.5, gv, 0.5, 0)
        pt = best_grasp_point(g)
        if pt:
            cv2.drawMarker(grasp_on, pt, (0, 255, 255), cv2.MARKER_CROSS, 24, 3)
            cv2.circle(grasp_on, pt, 10, (0, 255, 255), 2)

        row = np.hstack([
            label(fit_h(outlined), f"#{k} photo"),
            label(fit_h(relief_vis), "relief"),
            label(fit_h(grasp_on), "grasp"),
        ])
        rows.append(row)

    width = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 0, 6, 0, width - r.shape[1], cv2.BORDER_CONSTANT, value=(0, 0, 0)) for r in rows]
    gallery = np.vstack(rows)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"{args.stem}_grasp_panels.png")
    cv2.imwrite(out, gallery)
    print(f"{args.stem}: {len(insts)} holds -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
