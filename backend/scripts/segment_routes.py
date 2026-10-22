"""Render a single composite: a climbing wall with every hold filled by its
route color (holds grouped into routes via color-moment KMeans).

Provenance for rc/assets/demo/routes-by-color.jpg:
    source image  : data/bh/0075.jpg          (same wall as the beta/optimal-path render)
    annotations    : data/bh-annotation.json   (VIA format)
    dataset        : Kaggle "indoor-climbing-gym-hold-segmentation" (tomasslama)
    clustering      : color moments (mean+std of Hue) -> KMeans(n_clusters=6)
    logic           : mirrors demo.ipynb route-detection / std/utils.py

Regenerate:  python backend/scripts/segment_routes.py 0075.jpg --k 6 --out rc/assets/demo/routes-by-color.jpg
Needs: opencv-python, numpy, scikit-learn  (see backend/requirements.txt).
"""
import argparse, json, os
import numpy as np
import cv2 as cv
from sklearn.cluster import KMeans

ANN = "data/bh-annotation.json"
IMG_DIR = "data/bh"

# Distinct, saturated overlay palette (BGR) for route clusters.
PALETTE = [
    (60, 76, 231),   # red
    (80, 175, 76),   # green
    (219, 152, 52),  # blue
    (34, 126, 230),  # orange
    (182, 89, 155),  # purple
    (60, 200, 240),  # yellow
    (190, 190, 190), # grey / white
    (173, 68, 142),  # violet
]


def build_d_dict(filename):
    md = json.load(open(ANN))["_via_img_metadata"]
    entry = next((v for v in md.values() if v.get("filename") == filename), None)
    if entry is None:
        raise SystemExit(f"{filename} not found in {ANN}")
    img = cv.imread(os.path.join(IMG_DIR, filename))
    anns = []
    for rg in entry["regions"]:
        sa = rg["shape_attributes"]
        if sa.get("name") != "polygon":
            continue
        xs, ys = sa.get("all_points_x"), sa.get("all_points_y")
        if not xs or len(xs) < 3:
            continue
        is_vol = rg["region_attributes"].get("hold_type") == "volume"
        anns.append({"points": np.stack([xs, ys], 1).astype(np.int32),
                     "is_volume": is_vol})
    return img, anns


def render(filename, k, out):
    img, anns = build_d_dict(filename)
    hsv = cv.cvtColor(img, cv.COLOR_BGR2HSV)
    polys = [a["points"] for a in anns if not a["is_volume"]]  # volumes = wall, not route

    # color moments: mean + std of Hue per hold
    feats = []
    for pts in polys:
        mask = cv.fillPoly(np.zeros(img.shape[:2], np.uint8), [pts], 255)
        mean_v, std_v = cv.meanStdDev(hsv, mask=mask)
        feats.append([mean_v[0, 0], std_v[0, 0]])
    feats = np.array(feats, float)
    feats = (feats - feats.mean(0)) / (feats.std(0) + 1e-6)

    k = min(k, len(polys))
    labels = KMeans(n_clusters=k, random_state=42, n_init="auto").fit_predict(feats)

    base = (img.astype(float) * 0.38).astype(np.uint8)  # dim the wall
    overlay = base.copy()
    for pts, lab in zip(polys, labels):
        cv.fillPoly(overlay, [pts], PALETTE[lab % len(PALETTE)])
    out_img = cv.addWeighted(overlay, 0.78, base, 0.22, 0)
    for pts in polys:
        cv.polylines(out_img, [pts], True, (245, 245, 245), 2, cv.LINE_AA)

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    cv.imwrite(out, out_img)
    print(f"{filename}: {len(polys)} holds -> {k} routes -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?", default="0075.jpg")
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--out", default="rc/assets/demo/routes-by-color.jpg")
    a = ap.parse_args()
    render(a.image, a.k, a.out)
