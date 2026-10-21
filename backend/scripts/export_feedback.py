"""Export climbers' corrections from the app as training data.

The server keeps every scan and every correction under backend/store/scans/<id>/.
This turns that feedback into data the training scripts already read:

- data/app/<scan id>.jpg + data/app-annotation.csv — scans the climber confirmed with
  "Holds look right" (reviewedAt, POST /scans/<id>/review) only: a VIA-style CSV of the
  holds after corrections (turned-off/deleted holds gone, added boxes as polygons), so
  train_holds.py picks the "app" gym up like any other. label_type says app_corrected
  (the climber added/recolored it) or app_reviewed (a detection they confirmed);
  tap-to-pick routes become route_id. Unreviewed scans never go here: their untouched
  detections can be people or shadows.
- data/app-hold-colors.json — per-hold color labels (backend/eval/hold_colors.json
  format) for the holds the climber recolored or added, reviewed or not; other holds
  are listed with color null (exposure normalization only). build_color_refs.py and
  evaluate_pipeline.py add them to the color references.

"app" is a train-only gym (pipeline/splits.py): its labels are partly the model's own
detections, so it never enters the test split. Skipped: starter walls (copies of
dataset images) and any upload that looks like a labeled dataset image, so test
photos can't leak into training. Only exports — retrain yourself afterwards.
Each run rewrites the outputs from the store.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/export_feedback.py            # write
    ./.venv/bin/python backend/scripts/export_feedback.py --dry-run  # report only
(--store / --out point it at another store or output folder, e.g. for a test run.)
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import shutil
import sys

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.holds import load_via_index  # noqa: E402
from pipeline.photo_hash import dhash, distance  # noqa: E402
from pipeline.routes import APP_HOLD_COLORS, HOLD_COLORS_PATH  # noqa: E402
from pipeline.splits import APP_GYM, all_gyms  # noqa: E402

DATA = os.path.join(ROOT, "data")
STORE = os.path.join(BACKEND, "store", "scans")
DUPLICATE_BITS = 10  # dHash distance (of 64) under which an upload counts as a dataset photo


def labeled_photo_hashes() -> dict[int, str]:
    """dHash of every labeled dataset photo (detection, route-color or hold-color labels)."""
    paths = {s.path for s in load_via_index(DATA, [g for g in all_gyms(DATA) if g != APP_GYM])}
    for key in json.load(open(HOLD_COLORS_PATH)):
        if not key.startswith("_"):
            paths.add(os.path.join(DATA, key))
    out = {}
    for p in sorted(paths):
        bgr = cv2.imread(p)
        if bgr is not None:
            out[dhash(bgr)] = os.path.relpath(p, DATA)
    return out


def corrected_ids(scan_dir: str) -> tuple[set[str], set[str]]:
    """Hold ids the climber recolored, and every hold id their corrections touched."""
    recolored, touched = set(), set()
    path = os.path.join(scan_dir, "hold_corrections.jsonl")
    for line in open(path) if os.path.exists(path) else []:
        for c in json.loads(line)["corrections"]:
            if c["kind"] == "recolor":
                recolored.add(c["holdId"])
            if "holdId" in c:
                touched.add(c["holdId"])
    return recolored, touched


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report what would be exported, write nothing")
    ap.add_argument("--store", default=STORE, help="scans folder (default backend/store/scans)")
    ap.add_argument("--out", default=DATA, help="folder to write app/ and the label files (default data/)")
    args = ap.parse_args()

    known = labeled_photo_hashes()
    rows, colors, images, skipped = [], {}, {}, []
    stored = []
    for scan_dir in sorted(glob.glob(os.path.join(args.store, "*"))):
        if os.path.exists(os.path.join(scan_dir, "scan.json")):
            stored.append((scan_dir, json.load(open(os.path.join(scan_dir, "scan.json")))))
    # Reviewed scans first, so when a photo was scanned twice the reviewed copy is kept.
    for scan_dir, scan in sorted(stored, key=lambda t: not t[1].get("reviewedAt")):
        sid = os.path.basename(scan_dir)
        reviewed = bool(scan.get("reviewedAt"))
        if not reviewed and not os.path.exists(os.path.join(scan_dir, "hold_corrections.jsonl")):
            continue  # no feedback: its holds are only the model's own guesses
        if scan.get("status") != "done":
            skipped.append((sid, "not done"))
            continue
        if scan.get("featured") or scan.get("source"):
            skipped.append((sid, f"starter wall copied from {scan.get('source', 'the dataset')}"))
            continue
        img_path = os.path.join(scan_dir, "view_0.jpg")
        bgr = cv2.imread(img_path)
        if bgr is None:
            skipped.append((sid, "no image"))
            continue
        h = dhash(bgr)
        dup = next((name for k, name in known.items() if distance(k, h) <= DUPLICATE_BITS), None)
        if dup:
            skipped.append((sid, f"same photo as {dup}"))
            continue
        known[h] = f"exported {sid}"  # the same photo scanned twice counts once

        H, W = bgr.shape[:2]
        fname = f"{sid}.jpg"
        recolored, touched = corrected_ids(scan_dir)
        route_of = {hid: r["id"].rsplit("-", 1)[-1] for r in scan["routes"] if r.get("custom")
                    for hid in r["holdIds"]}
        holds = scan["holds"]
        added = {x["id"] for x in holds if "-add-" in x["id"]}
        for i, x in enumerate(holds if reviewed else []):
            kind = scan["geom"].get(x["id"], {}).get("kind", "hold")
            attrs = {"label_type": "app_corrected" if x["id"] in touched | added else "app_reviewed",
                     "hold_type": "volume" if kind == "volume" else "hold"}
            if x["id"] in route_of:
                attrs["route_id"] = f"custom-{route_of[x['id']]}"
            shape = {"name": "polygon",
                     "all_points_x": [round(p["x"] * W) for p in x["polygon"]],
                     "all_points_y": [round(p["y"] * H) for p in x["polygon"]]}
            rows.append({"filename": fname, "file_attributes": "{}", "region_count": len(holds),
                         "region_id": i, "region_shape_attributes": json.dumps(shape),
                         "region_attributes": json.dumps(attrs)})
        labeled = [x for x in holds if x["id"] in recolored | added]
        if labeled:
            colors[f"{APP_GYM}/{fname}"] = [
                {"polygon": [[round(p["x"], 4), round(p["y"], 4)] for p in x["polygon"]],
                 "color": x["color"] if x["id"] in recolored | added else None} for x in holds]
        if reviewed or labeled:
            images[fname] = img_path
        print(f"{sid}: {'reviewed' if reviewed else 'not reviewed (colors only)'}, {len(holds)} holds, "
              f"{len(touched | added)} corrected, {len(labeled)} color labels, "
              f"{len(route_of)} holds in tap-to-pick routes")

    for sid, why in skipped:
        print(f"skipped {sid}: {why}")
    print(f"{len(images)} scans → {len(rows)} hold polygons (reviewed scans), {sum(1 for v in colors.values() for x in v if x['color'])} color labels")
    if args.dry_run:
        return 0

    out_dir = os.path.join(args.out, APP_GYM)
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, "*.jpg")):  # rewrite from the store each run
        if os.path.basename(old) not in images:
            os.remove(old)
    for fname, src in images.items():
        shutil.copyfile(src, os.path.join(out_dir, fname))
    for r in rows:
        r["file_size"] = os.path.getsize(os.path.join(out_dir, r["filename"]))
    fields = ["filename", "file_size", "file_attributes", "region_count", "region_id",
              "region_shape_attributes", "region_attributes"]
    with open(os.path.join(args.out, f"{APP_GYM}-annotation.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(args.out, APP_HOLD_COLORS), "w") as f:
        json.dump({"_about": "Hold colors climbers set in the app (recolored or added holds), "
                   "written by backend/scripts/export_feedback.py. Same format as "
                   "backend/eval/hold_colors.json; train-only.", **colors}, f)
    print(f"wrote {APP_GYM}/, {APP_GYM}-annotation.csv and {APP_HOLD_COLORS} in {os.path.relpath(args.out, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
