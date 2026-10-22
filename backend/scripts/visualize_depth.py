"""Visualize M11 per-hold depth: overlay holds on the wall photo colored by their
(approximate) protrusion, next to the colorized DA3 depth map.

Protrusions from full-image DA3 are shallow/approximate (see PROGRESS.md) — this is
a qualitative view of relative depth per hold, not calibrated mm.

Run from the parent "rock climbing" folder (after build_depth_records / Colab depth):
    ./.venv/bin/python backend/scripts/visualize_depth.py --depth-dir backend/artifacts/da3_depth
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

from pipeline.depth import (  # noqa: E402
    backproject,
    fit_wall_plane,
    intrinsics_from_focal_px,
    process_hold,
)
from pipeline.depth_model import load_depth_npz  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402

GRAVITY = np.array([0.0, 1.0, 0.0])
OUT = os.path.join(BACKEND, "artifacts", "depth", "viz")


def analyze(sample, depth_path):
    depth_m, meta = load_depth_npz(depth_path)
    bgr = cv2.imread(sample.path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    dh, dw = depth_m.shape
    scale = max(dh, dw) / max(h, w)
    depth_full = cv2.resize((depth_m * scale).astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
    intr = intrinsics_from_focal_px(w, h, meta["focal_px"], "exif")
    pts = backproject(depth_full, intr)

    masks = []
    for inst in sample.instances:
        m = np.zeros((h, w), np.uint8)
        cv2.fillPoly(m, [inst.points.astype(np.int32)], 1)
        masks.append(m.astype(bool))
    any_hold = np.any(masks, axis=0)
    n, d, noise = fit_wall_plane(pts, ~any_hold)

    results = []
    for inst, mask in zip(sample.instances, masks):
        rec, _ = process_hold(pts, rgb, mask, n, d, GRAVITY, noise, intr,
                              "assumed", "h", "hold", "x", "da3")
        if rec is not None:
            results.append((inst.points.astype(np.int32), rec.summary.max_protrusion_mm))
    return bgr, depth_full, results


def colorbar(img, vmax, label):
    h = img.shape[0]
    bar = np.zeros((h, 40, 3), np.uint8)
    grad = np.linspace(255, 0, h).astype(np.uint8)[:, None]
    bar[:, :] = cv2.applyColorMap(np.repeat(grad, 40, 1), cv2.COLORMAP_INFERNO)
    out = np.hstack([img, bar])
    cv2.putText(out, f"{vmax:.0f}mm", (img.shape[1] - 2, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(out, "0", (img.shape[1] + 4, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(out, label, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    return out


def render(bgr, depth_full, results, out_path):
    h, w = bgr.shape[:2]
    prots = [p for _, p in results if p > 0]
    vmax = float(np.percentile(prots, 95)) if prots else 10.0
    vmax = max(vmax, 3.0)

    overlay = bgr.copy()
    for poly, prot in results:
        t = int(np.clip(prot / vmax, 0, 1) * 255)
        color = cv2.applyColorMap(np.array([[t]], np.uint8), cv2.COLORMAP_INFERNO)[0, 0]
        cv2.fillPoly(overlay, [poly], [int(c) for c in color])
    blended = cv2.addWeighted(overlay, 0.55, bgr, 0.45, 0)
    for poly, _ in results:
        cv2.polylines(blended, [poly], True, (255, 255, 255), 1)
    left = colorbar(blended, vmax, "approx protrusion")

    # colorized DA3 depth map (relative)
    dn = depth_full.copy()
    dn = (dn - dn.min()) / (dn.max() - dn.min() + 1e-9)
    dcol = cv2.applyColorMap((dn * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    cv2.putText(dcol, "DA3 depth (near->far)", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

    # stack side by side (match heights)
    scale = left.shape[0] / dcol.shape[0]
    dcol = cv2.resize(dcol, (int(dcol.shape[1] * scale), left.shape[0]))
    combo = np.hstack([left, dcol])
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cv2.imwrite(out_path, combo)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth-dir", default=os.path.join(BACKEND, "artifacts", "da3_depth"))
    ap.add_argument("--stems", nargs="+", default=["0917", "0075", "0274", "108"])
    args = ap.parse_args()

    index = {os.path.splitext(os.path.basename(s.path))[0]: s
             for s in load_via_index(os.path.join(ROOT, "data"), ["bh", "sm", "bh-phone"])}
    done = 0
    for stem in args.stems:
        s = index.get(stem)
        npz = os.path.join(args.depth_dir, f"{stem}.npz")
        if s is None or not os.path.exists(npz):
            print(f"  skip {stem} (missing sample or depth)")
            continue
        bgr, depth_full, results = analyze(s, npz)
        out = os.path.join(OUT, f"{stem}_depth.png")
        render(bgr, depth_full, results, out)
        print(f"  {stem}: {len(results)} holds -> {out}")
        done += 1
    print(f"\nwrote {done} visualizations under {OUT}")
    return 0 if done else 1


if __name__ == "__main__":
    raise SystemExit(main())
