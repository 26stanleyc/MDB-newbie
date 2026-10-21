"""Build the app's hold-color reference set (artifacts/color_refs.npz).

Every labeled route in backend/eval/route_colors.json, every labeled hold in
backend/eval/hold_colors.json and every hold color climbers set in the app
(data/app-hold-colors.json, from scripts/export_feedback.py) contributes its color;
the server names hold colors by k-NN against these. Re-run after labeling more
routes. --split train builds from training images only (what evaluate_pipeline.py
uses internally, so test numbers stay honest); the default uses everything.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/build_color_refs.py
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.holds import load_via_index  # noqa: E402
from pipeline.routes import APP_HOLD_COLORS, COLOR_REFS_PATH, ColorNamer  # noqa: E402
from pipeline.scan import working_image  # noqa: E402
from pipeline.splits import all_gyms, split_of  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="all", choices=["train", "all"])
    ap.add_argument("--out", default=COLOR_REFS_PATH)
    args = ap.parse_args()
    data = os.path.join(ROOT, "data")
    samples = [s for s in load_via_index(data, all_gyms(data))
               if args.split == "all" or split_of(s.gym, s.path) == "train"]
    keep = lambda key: args.split == "all" or split_of(*key.split("/", 1)) == "train"  # noqa: E731
    namer = ColorNamer.from_samples(samples, working_image).merged(
        ColorNamer.from_hold_labels(data, working_image, keep=keep)).merged(
        ColorNamer.from_hold_labels(data, working_image, keep=keep, path=os.path.join(data, APP_HOLD_COLORS)))
    namer.save(args.out)
    print(f"{len(namer.names)} labeled holds: {dict(Counter(namer.names.tolist()).most_common())}")
    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
