"""Evaluate single-photo wall-angle estimation: surface normals → wall panels → angles.

Segments the bare wall (between the holds) by surface normal into panels, then reports
each panel's angle. Two readings:
  - inter-panel angle vs the main wall (gravity-free, robust): how much an overhang
    leans relative to the main face.
  - absolute angle from vertical using a SIMULATED gravity (real app uses the captured
    gravity vector) — labeled as simulated.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/eval_wall_angles.py --stems 0917 0075
"""

from __future__ import annotations

import argparse
import os
import sys

import cv2
import numpy as np
from sklearn.cluster import KMeans

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.holds import load_via_index  # noqa: E402
from pipeline.wall_normals import (  # noqa: E402
    angle_between,
    angle_from_vertical,
    normal_map,
    smooth_normals,
)

OUT = os.path.join(BACKEND, "artifacts", "grasp")
SIM_GRAVITY = np.array([0.0, 1.0, 0.0])  # simulated: "down" = image-down (real app: M2)
PANEL_COLORS = [(80, 200, 120), (230, 150, 60), (200, 90, 200), (90, 160, 230)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stems", nargs="+", default=["0917", "0075"])
    ap.add_argument("--gyms", nargs="+", default=["bh", "sm", "bh-phone"])
    ap.add_argument("--panels", type=int, default=4)
    ap.add_argument("--spatial", type=float, default=0.0,
                    help="weight of pixel position in clustering (0 = pure normals, "
                         "honest geometry; >0 gives clean but position-driven splits)")
    ap.add_argument("--median", type=int, default=11, help="label-cleanup kernel (odd)")
    args = ap.parse_args()

    idx = {os.path.splitext(os.path.basename(s.path))[0]: s
           for s in load_via_index(os.path.join(ROOT, "data"), args.gyms)}
    os.makedirs(OUT, exist_ok=True)

    for stem in args.stems:
        s = idx.get(stem)
        if s is None:
            print(f"  skip {stem}")
            continue
        bgr = cv2.imread(s.path)
        H, W = bgr.shape[:2]
        # Higher-quality normals (ensemble + resolution) then spatial smoothing,
        # so panel clustering isn't salt-and-pepper.
        N = normal_map(bgr, steps=4, resolution=1024, ensemble=5)
        N = smooth_normals(N, sigma=max(3.0, W / 700))  # gentle denoise, keep the fold

        # Wall area = convex hull of all holds (the climbed region), minus the holds.
        allpts = np.vstack([inst.points.astype(np.int32) for inst in s.instances])
        hull = cv2.convexHull(allpts)
        area = np.zeros((H, W), np.uint8)
        cv2.fillConvexPoly(area, hull, 1)
        area = cv2.dilate(area, np.ones((41, 41), np.uint8))
        holds = np.zeros((H, W), np.uint8)
        for inst in s.instances:
            cv2.fillPoly(holds, [inst.points.astype(np.int32)], 1)
        wall = (area.astype(bool)) & (~holds.astype(bool))

        # Segmentation features: normals + a weak spatial term, so a genuine
        # top/bottom fold separates cleanly (Marigold under-captures subtle folds, so
        # pure-normal clustering merges them). Angles are recomputed from real normals.
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        xs_n = (xx / W - 0.5) * 2.0
        ys_n = (yy / H - 0.5) * 2.0
        F = np.concatenate([N, args.spatial * xs_n[..., None], args.spatial * ys_n[..., None]], -1)
        fw = F[wall]
        fit = fw[np.random.default_rng(0).choice(len(fw), min(30000, len(fw)), replace=False)]
        km = KMeans(n_clusters=args.panels, n_init=4, random_state=0).fit(fit)
        lab = np.full((H, W), -1, np.int32)
        lab[wall] = km.predict(fw)

        # Spatial cleanup: median-filter the label map to remove speckle (gentle, so
        # the geometry-driven diagonal boundary survives).
        labu = cv2.medianBlur((lab + 1).astype(np.uint8), args.median)
        lab = labu.astype(np.int32) - 1
        lab[~wall] = -1

        # Real orientation per panel = mean of the actual normals in its region.
        panel_n = {}
        for k in range(args.panels):
            m = lab == k
            if m.sum() > 0:
                c = N[m].mean(0)
                panel_n[k] = c / (np.linalg.norm(c) + 1e-9)

        counts = [(int((lab == k).sum()), k) for k in range(args.panels) if (lab == k).sum() > 0]
        counts.sort(reverse=True)
        keep = [k for c, k in counts if c > 0.015 * wall.sum()]
        main_k = counts[0][1]
        main_n = panel_n[main_k]

        overlay = bgr.copy()
        print(f"\n{stem}: {len(keep)} wall panels")
        for rank, k in enumerate(keep):
            n = panel_n[k]
            rel = angle_between(n, main_n)
            av = angle_from_vertical(n, SIM_GRAVITY)
            tag = "MAIN wall" if k == main_k else f"panel {rank}"
            col = PANEL_COLORS[rank % len(PANEL_COLORS)]
            overlay[lab == k] = (0.5 * np.array(col) + 0.5 * overlay[lab == k]).astype(np.uint8)
            # label near the panel centroid
            ys, xs = np.where(lab == k)
            cy, cx = int(ys.mean()), int(xs.mean())
            txt = f"{tag}: {rel:.0f}deg vs main | {av:+.0f}deg vs vert(sim)"
            cv2.putText(overlay, txt, (max(5, cx - 180), cy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
            cv2.putText(overlay, txt, (max(5, cx - 180), cy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1)
            slope = "right-up" if n[0] > 0.02 else ("left-up" if n[0] < -0.02 else "flat-x")
            print(f"   {tag}: {int((lab == k).sum())} px | normal=({n[0]:+.2f},{n[1]:+.2f},{n[2]:+.2f}) "
                  f"| x-slope {slope} | {rel:.1f}deg vs main | {av:+.1f}deg vs vert(sim)")

        # normal-map panel for context
        nmap = np.ascontiguousarray(((N * 0.5 + 0.5) * 255).astype(np.uint8)[:, :, ::-1])
        cv2.putText(nmap, "surface normals (Marigold)", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4)
        cv2.putText(nmap, "surface normals (Marigold)", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 1)
        combo = np.hstack([overlay, nmap])
        cv2.imwrite(os.path.join(OUT, f"{stem}_wall_angles.png"), combo)
        print(f"   -> {OUT}/{stem}_wall_angles.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
