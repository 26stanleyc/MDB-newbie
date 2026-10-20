"""DA3METRIC-LARGE depth inference — the ONE GPU step of M11.

Run this on a GPU (Colab free T4 is enough). It reads a folder of wall images,
runs DA3METRIC-LARGE, converts the output to metric depth, and writes one
`<stem>.npz` per image (depth in meters + focal used). Download that folder and
feed it to `backend/scripts/build_depth_records.py` locally — the rest of M11 is
CPU and needs no GPU.

Metric conversion (official DA3 card): metric = focal_px * net_output / 300,
with focal_px = 35mm-equivalent focal / 36 * long-side-px (from EXIF, else a
default). We embed the exact focal_px so the local geometry stays consistent.

Colab usage (see README.md):
    !pip -q install git+https://github.com/ByteDance-Seed/Depth-Anything-3.git pillow numpy
    !python da3_inference.py --images /content/images --out /content/depth
"""

from __future__ import annotations

import argparse
import os

import numpy as np
from PIL import Image

SENSOR_35MM_WIDTH = 36.0
DEFAULT_FOCAL_35MM = 26.0
DA3_METRIC_DIVISOR = 300.0
MODEL_ID = "depth-anything/DA3METRIC-LARGE"
IMG_EXT = (".jpg", ".jpeg", ".png")


def focal_px_from_exif(img: Image.Image, width: int, height: int) -> tuple[float, str]:
    long_side = max(width, height)
    focal35 = None
    try:
        exif = img.getexif()
        # 0xA405 = FocalLengthIn35mmFilm
        focal35 = exif.get(0xA405)
        focal35 = float(focal35) if focal35 else None
    except Exception:
        focal35 = None
    if focal35 and focal35 > 0:
        return focal35 / SENSOR_35MM_WIDTH * long_side, "exif"
    return DEFAULT_FOCAL_35MM / SENSOR_35MM_WIDTH * long_side, "default"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="folder of wall images")
    ap.add_argument("--out", required=True, help="output folder for <stem>.npz")
    ap.add_argument("--model", default=MODEL_ID)
    args = ap.parse_args()

    import torch
    from depth_anything_3.api import DepthAnything3  # GPU side only

    os.makedirs(args.out, exist_ok=True)
    model = DepthAnything3.from_pretrained(args.model).to(torch.device("cuda"))

    files = sorted(f for f in os.listdir(args.images) if f.lower().endswith(IMG_EXT))
    print(f"{len(files)} images → {args.out}")
    for i, fname in enumerate(files):
        path = os.path.join(args.images, fname)
        img = Image.open(path).convert("RGB")
        w, h = img.size

        pred = model.inference([path])
        raw = np.asarray(pred.depth[0], dtype=np.float32)   # net output (H, W)
        # Focal px: prefer DA3's estimated intrinsics, else EXIF, else default.
        fpx, source = None, None
        try:
            K = np.asarray(pred.intrinsics[0])
            fpx, source = float((K[0, 0] + K[1, 1]) / 2), "da3"
        except Exception:
            fpx = None
        if not fpx or fpx <= 0:
            fpx, source = focal_px_from_exif(img, w, h)
        depth_m = raw * fpx / DA3_METRIC_DIVISOR

        stem = os.path.splitext(fname)[0]
        np.savez_compressed(
            os.path.join(args.out, f"{stem}.npz"),
            depth_m=depth_m, scan_id=stem, model_version="da3metric-large",
            focal_px=float(fpx), focal_source=source,
        )
        if (i + 1) % 5 == 0 or i == len(files) - 1:
            print(f"  [{i+1}/{len(files)}] {stem}  focal_px={fpx:.1f} ({source})  "
                  f"depth {depth_m.min():.2f}-{depth_m.max():.2f} m", flush=True)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
