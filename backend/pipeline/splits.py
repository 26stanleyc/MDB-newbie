"""Train/test split for every labeled image, stable as data is added.

- Whole gyms in TEST_GYMS are held out (cross-gym generalization — the real use case).
- Every other gym is split per image by a hash of "<gym>/<stem>": the lowest
  TEST_PERCENT go to test. The hash never changes, so adding images never moves an
  existing image between splits, and new gyms/images are assigned automatically.

- APP_GYM ("app", written by scripts/export_feedback.py from climbers' corrections in
  the app) is always train: its labels are partly the model's own detections.

To add data: drop images in data/<gym>/ with data/<gym>-annotation.csv (VIA export).
"""

from __future__ import annotations

import glob
import hashlib
import os

TEST_GYMS = {"sm", "bh-phone"}
TEST_PERCENT = 25
APP_GYM = "app"


def all_gyms(data_dir: str) -> list[str]:
    """Every gym that has a VIA annotation CSV."""
    return sorted(
        os.path.basename(p)[: -len("-annotation.csv")]
        for p in glob.glob(os.path.join(data_dir, "*-annotation.csv"))
    )


def split_of(gym: str, filename: str) -> str:
    if gym == APP_GYM:
        return "train"
    if gym in TEST_GYMS:
        return "test"
    stem = os.path.splitext(os.path.basename(filename))[0]
    bucket = int(hashlib.sha1(f"{gym}/{stem}".encode()).hexdigest(), 16) % 100
    return "test" if bucket < TEST_PERCENT else "train"
