"""Validate M7 image quality check against the real labeled wall photos.

Two things it checks:
  1. Real wall photos should (almost all) PASS.
  2. Degraded copies should be caught: blurred -> blurry, darkened -> too_dark,
     blank gray -> no_wall_detected.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/evaluate_quality.py
"""

from __future__ import annotations

import os
import random
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.quality import (  # noqa: E402
    check_image_quality,
    compute_metrics,
    BLUR_MIN_VAR,
    DARK_MEAN_MAX,
    WALL_COLORFULNESS_MIN,
    WALL_EDGE_DENSITY_MIN,
)

DATA = os.path.join(ROOT, "data")
GYMS = ["bh", "bh-phone", "sm"]
PER_GYM = 60
SEED = 0


def sample_images() -> list[str]:
    random.seed(SEED)
    paths: list[str] = []
    for gym in GYMS:
        d = os.path.join(DATA, gym)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.lower().endswith((".jpg", ".jpeg", ".png")))
        for f in random.sample(files, min(PER_GYM, len(files))):
            paths.append(os.path.join(d, f))
    return paths


def pct(vals, p):
    return float(np.percentile(vals, p)) if vals else float("nan")


def main() -> int:
    paths = sample_images()
    print(f"Sampled {len(paths)} wall photos from {GYMS}\n")

    metrics = {k: [] for k in ["blur_var", "mean_luma", "dark_fraction", "colorfulness", "edge_density"]}
    passes = 0
    fail_reasons: dict[str, int] = {}
    imgs = []  # keep a few for degradation tests

    for i, p in enumerate(paths):
        bgr = cv2.imread(p)
        if bgr is None:
            continue
        m = compute_metrics(bgr)
        for k, v in m.items():
            metrics[k].append(v)
        res = check_image_quality(bgr)
        if res.ok:
            passes += 1
        else:
            fail_reasons[res.reason] = fail_reasons.get(res.reason, 0) + 1
        if i < 20:
            imgs.append(bgr)

    print("Metric distribution across real walls (p1 / p5 / p50 / p95):")
    for k, vals in metrics.items():
        print(f"  {k:14s} {pct(vals,1):10.3f} {pct(vals,5):10.3f} {pct(vals,50):10.3f} {pct(vals,95):10.3f}")
    print()
    print(f"Thresholds: blur>{BLUR_MIN_VAR}, mean_luma>{DARK_MEAN_MAX}, "
          f"wall(colorfulness>{WALL_COLORFULNESS_MIN} or edge>{WALL_EDGE_DENSITY_MIN})")
    rate = 100.0 * passes / max(1, len(metrics["blur_var"]))
    print(f"\nREAL WALLS pass rate: {passes}/{len(metrics['blur_var'])} = {rate:.1f}%")
    if fail_reasons:
        print(f"  false rejections: {fail_reasons}")

    # --- Degradation tests ---
    print("\nDegradation tests (each should be caught):")
    blur_caught = dark_caught = 0
    for bgr in imgs:
        blurred = cv2.GaussianBlur(bgr, (0, 0), sigmaX=12)
        if check_image_quality(blurred).reason == "blurry":
            blur_caught += 1
        dark = (bgr.astype("float32") * 0.12).astype("uint8")
        if check_image_quality(dark).reason == "too_dark":
            dark_caught += 1
    # Blank frame must be rejected (no holds/texture). Blur gates first, so the
    # reason may be blurry or no_wall_detected — either is a correct rejection.
    blank = np.full((1200, 900, 3), 128, np.uint8)
    blank_rejected = not check_image_quality(blank).ok
    # Directly exercise the wall branch: sharp noise (passes blur) but gray +
    # textureless-color should read as no_wall via low colorfulness.
    rng = np.random.default_rng(0)
    noise_gray = rng.integers(90, 160, (1200, 900), dtype="uint8")
    noise_bgr = cv2.cvtColor(noise_gray, cv2.COLOR_GRAY2BGR)
    noise_res = check_image_quality(noise_bgr)

    n = len(imgs)
    print(f"  blurred  -> blurry:   {blur_caught}/{n}")
    print(f"  darkened -> too_dark: {dark_caught}/{n}")
    print(f"  blank    -> rejected: {blank_rejected} (reason {check_image_quality(blank).reason})")
    print(f"  gray noise wall-branch: ok={noise_res.ok} reason={noise_res.reason} "
          f"(colorfulness={noise_res.metrics['colorfulness']:.1f})")

    ok = (rate >= 95.0 and blur_caught >= 0.9 * n and dark_caught >= 0.9 * n and blank_rejected)
    print("\nM7 validation:", "PASS" if ok else "NEEDS TUNING")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
