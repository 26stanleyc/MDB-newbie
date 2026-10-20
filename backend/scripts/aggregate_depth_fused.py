"""Fused, slope-aware whole-wall depth aggregate (NEW).

Composites each hold's metric, wall-normal protrusion (from fused_depth) onto the
full image with ONE shared scale, so holds are comparable to each other (unlike the
relative aggregate_depth.py, which self-normalizes each hold). Also reports the
local wall-slope variation (so you can see the wall isn't a flat 2D plane).

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/aggregate_depth_fused.py --stems 0075 0917
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

from pipeline.depth_model import load_depth_npz  # noqa: E402
from pipeline.fused_depth import fused_hold  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402

OUT = os.path.join(BACKEND, "artifacts", "grasp")
DA3_DIR = os.path.join(BACKEND, "artifacts", "da3_depth")


def load_da3_metric(stem, H, W):
    depth_m, meta = load_depth_npz(os.path.join(DA3_DIR, f"{stem}.npz"))
    dh, dw = depth_m.shape
    scale = max(dh, dw) / max(H, W)                 # fix depth/focal resolution
    Z = cv2.resize((depth_m * scale).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    return Z, float(meta["focal_px"])


def colorbar(img, vmax, label, unit="mm"):
    h = img.shape[0]
    grad = cv2.applyColorMap(np.repeat(np.linspace(255, 0, h).astype(np.uint8)[:, None], 40, 1),
                             cv2.COLORMAP_INFERNO)
    out = np.hstack([img, grad])
    cv2.putText(out, f"{vmax:.0f}{unit}", (img.shape[1] + 1, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    cv2.putText(out, "0", (img.shape[1] + 14, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    cv2.putText(out, label, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return out


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
        if s is None or not os.path.exists(os.path.join(DA3_DIR, f"{stem}.npz")):
            print(f"  skip {stem}")
            continue
        bgr = cv2.imread(s.path)
        H, W = bgr.shape[:2]
        Zda3, focal = load_da3_metric(stem, H, W)

        canvas = np.zeros((H, W), np.float32)
        tilts, maxprots = [], []
        for inst in s.instances:
            r = fused_hold(bgr, inst.points, Zda3, focal)
            pm, mask = r["prot_mm"], r["mask"]
            cx0, cy0, cx1, cy1 = r["bbox"]
            if pm.max() <= 0:
                continue
            canvas[cy0:cy1, cx0:cx1] = np.maximum(canvas[cy0:cy1, cx0:cx1], pm)
            tilts.append(r["tilt_deg"])
            maxprots.append(float(pm.max()))

        pos = canvas[canvas > 0]
        vmax = float(np.percentile(pos, 95)) if pos.size else 10.0
        norm = np.clip(canvas / max(vmax, 1e-6), 0, 1)
        heat = cv2.applyColorMap((norm * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
        heat[canvas <= 0] = (20, 20, 20)
        overlay = cv2.addWeighted(bgr, 0.45, heat, 0.55, 0)
        overlay[canvas <= 0] = bgr[canvas <= 0]
        combo = colorbar(np.hstack([overlay, heat]), vmax, "fused metric protrusion (along wall normal)")
        cv2.imwrite(os.path.join(OUT, f"{stem}_wall_depth_fused.png"), combo)

        mp = np.array(maxprots); tl = np.array(tilts)
        print(f"  {stem}: {len(maxprots)} holds | wall ~{np.median([*([Zda3.mean()])]):.2f} m")
        print(f"     per-hold max protrusion mm  p10/50/90: "
              f"{np.percentile(mp,10):.0f}/{np.percentile(mp,50):.0f}/{np.percentile(mp,90):.0f}")
        print(f"     local wall tilt deg (slope spread) p10/50/90: "
              f"{np.percentile(tl,10):.0f}/{np.percentile(tl,50):.0f}/{np.percentile(tl,90):.0f}")
        print(f"     -> {OUT}/{stem}_wall_depth_fused.png (compare to {stem}_wall_depth.png)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
