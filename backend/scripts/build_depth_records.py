"""M11 record builder (local, CPU) — stitch DA3 depth + holds + colors → records.

Takes the per-image metric-depth .npz produced by Colab (backend/colab), the hold
polygons (VIA GT here; the M9 detector can supply holds for unlabeled images), and
M10 colors, and runs the M11 geometry to write a HoldDepthRecord per hold.

Run from the parent "rock climbing" folder, after downloading Colab depth:
    ./.venv/bin/python backend/scripts/build_depth_records.py --depth-dir /path/to/depth

Dataset images carry no CaptureMeta gravity, so gravity is assumed vertical and the
records are flagged 'assumed_gravity' (lower confidence) — honest for this data.
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

from pipeline.depth import process_scan, save_records  # noqa: E402
from pipeline.depth_model import load_depth_npz  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402
from pipeline.routes import classify_and_group, hold_color_lab  # noqa: E402

DATA = os.path.join(ROOT, "data")
OUT = os.path.join(BACKEND, "artifacts", "depth")
GRAVITY_ASSUMED = np.array([0.0, 1.0, 0.0])  # +y down = vertical wall assumption


def build_one(sample, depth_path, out_dir):
    depth_m, meta = load_depth_npz(depth_path)
    bgr = cv2.imread(sample.path)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    dh, dw = depth_m.shape  # DA3 output resolution (usually downscaled)

    # DA3's net output + its focal must share a resolution: the metric focal belongs
    # at the DEPTH resolution (what pred.intrinsics would be), but Colab used the
    # full-res focal. Correcting the metric is just a constant factor = depth/orig
    # long-side; then upsample depth to full res (masks stay full-size, so small holds
    # keep detail) and use the full-res focal, which is now consistent.
    # (Dataset images have no EXIF → focal is the assumed default; records are flagged
    # assumed_intrinsics/assumed_gravity.)
    scale = max(dh, dw) / max(h, w)
    depth_full = cv2.resize((depth_m * scale).astype(np.float32), (w, h),
                            interpolation=cv2.INTER_LINEAR)
    focal_px = meta["focal_px"]  # full-res focal, now matching upsampled depth

    # Masks + colors (M10) at full resolution (one Lab conversion, reused).
    lab_full = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    masks, labs, labels = [], [], []
    for inst in sample.instances:
        m = np.zeros((h, w), np.uint8)
        cv2.fillPoly(m, [inst.points.astype(np.int32)], 1)
        lab = hold_color_lab(bgr, m, lab=lab_full)
        if lab is None:
            continue
        masks.append(m.astype(bool))
        labs.append(lab)
        labels.append("hold" if inst.label == 1 else "volume")
    if not masks:
        return None
    names, _ = classify_and_group(labs)

    holds = [
        {"id": f"h{i}", "mask": masks[i], "label": labels[i], "color": names[i]}
        for i in range(len(masks))
    ]
    wall, records, arrays = process_scan(
        rgb, depth_full, holds, w, h, GRAVITY_ASSUMED, focal_px=focal_px,
        gravity_source="assumed", model_version=meta["model_version"],
    )
    save_records(out_dir, meta["scan_id"], wall, records, arrays)
    return wall, records


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth-dir", required=True, help="folder of <stem>.npz from Colab")
    ap.add_argument("--gyms", nargs="+", default=["bh", "sm", "bh-phone"])
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    scans = holds_total = skipped = 0
    confs = []
    for gym in args.gyms:
        for s in load_via_index(DATA, [gym]):
            stem = os.path.splitext(os.path.basename(s.path))[0]
            npz = os.path.join(args.depth_dir, f"{stem}.npz")
            if not os.path.exists(npz):
                skipped += 1
                continue
            res = build_one(s, npz, os.path.join(args.out, f"{gym}-{stem}"))
            if res is None:
                continue
            _, records = res
            scans += 1
            holds_total += len(records)
            confs.extend(r.confidence for r in records)
            print(f"  {gym}/{stem}: {len(records)} holds, "
                  f"wall {res[0].angle_deg:+.1f}deg, mean conf "
                  f"{np.mean([r.confidence for r in records]):.2f}")

    print(f"\nscans: {scans} | holds: {holds_total} | skipped (no depth): {skipped}")
    if confs:
        print(f"mean confidence: {np.mean(confs):.2f}")
    print(f"records written under: {args.out}")
    return 0 if scans else 1


if __name__ == "__main__":
    raise SystemExit(main())
