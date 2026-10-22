"""Original photo vs reconstructed geometry (fold angle + metric scale from hold size).

Combines the two upgrades on one multi-view cloud:
  - fold detection: cluster surface normals -> two faces -> dihedral angle;
  - metric scale: detect colored holds, measure their size in cloud units, divide by
    an assumed average real hold size -> scale the whole cloud to meters.
Then renders a side-by-side: the reference photo and the top-down geometry (two faces
colored, fold angle labelled, axes in meters).

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/multiview/compare_geometry.py --wall wall_0310 --ref 0310
"""

from __future__ import annotations

import argparse
import os

import cv2
import numpy as np
import trimesh
from sklearn.cluster import DBSCAN, KMeans
from sklearn.neighbors import NearestNeighbors

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSUMED_HOLD_M = 0.14  # average real hold longest dimension


def estimate_normals(P, k=24):
    nn = NearestNeighbors(n_neighbors=k).fit(P)
    _, idx = nn.kneighbors(P)
    c = P[idx] - P[idx].mean(1, keepdims=True)
    cov = np.einsum("nki,nkj->nij", c, c) / k
    _, v = np.linalg.eigh(cov)
    n = v[:, :, 0]
    n[n[:, 2] > 0] *= -1
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)


def two_faces(P, n):
    """Assign points to 2 faces by normal, fit a plane to each, return (labels, angle)."""
    lab = KMeans(2, n_init=5, random_state=0).fit_predict(n)

    def pn(pts):
        pts = pts - pts.mean(0)
        return np.linalg.svd(pts, full_matrices=False)[2][-1]

    a, b = pn(P[lab == 0]), pn(P[lab == 1])
    ang = float(np.degrees(np.arccos(np.clip(abs(a @ b), 0, 1))))
    return lab, ang


def hold_scale(P, colors, assumed=ASSUMED_HOLD_M):
    """Detect colored holds, measure median longest dim in cloud units -> metric scale."""
    rgb = colors[:, :3].astype(np.float32) / 255
    mx, mn = rgb.max(1), rgb.min(1)
    sat = (mx - mn) / (mx + 1e-6)
    colored = sat > 0.4
    Pc = P[colored]
    if len(Pc) > 25000:
        Pc = Pc[np.random.default_rng(0).choice(len(Pc), 25000, replace=False)]
    span = np.linalg.norm(P.max(0) - P.min(0))
    db = DBSCAN(eps=span * 0.012, min_samples=25).fit(Pc)
    sizes = []
    for lbl in set(db.labels_):
        if lbl == -1:
            continue
        blob = Pc[db.labels_ == lbl]
        if len(blob) < 25:
            continue
        c = blob - blob.mean(0)
        axis = np.linalg.svd(c, full_matrices=False)[2][0]
        proj = c @ axis
        sizes.append(proj.max() - proj.min())
    med = float(np.median(sizes)) if sizes else span * 0.03
    return assumed / med, med, len(sizes)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wall", default="wall_0310")
    ap.add_argument("--ref", default="0310")
    ap.add_argument("--assumed", type=float, default=ASSUMED_HOLD_M)
    args = ap.parse_args()

    ply = os.path.join(HERE, "clouds", f"{args.wall}.ply")
    if not os.path.exists(ply):
        ply = os.path.join(HERE, "clouds", "out", args.wall, "wall_cloud.ply")
    mesh = trimesh.load(ply)
    P = np.asarray(mesh.vertices, dtype=np.float32)
    C = np.asarray(mesh.visual.vertex_colors)

    scale, med, nholds = hold_scale(P, C, args.assumed)
    Pm = P * scale  # metric

    sub = np.random.default_rng(0).choice(len(Pm), min(40000, len(Pm)), replace=False)
    Ps = Pm[sub]
    n = estimate_normals(Ps)
    lab, angle = two_faces(Ps, n)

    dims = Pm.max(0) - Pm.min(0)
    print(f"{args.wall}: fold {angle:.0f} deg | hold med {med*1000*scale:.0f} mm (assumed {args.assumed*1000:.0f}) "
          f"| scale {scale:.2f}x | wall ~{dims[0]:.1f} m wide x {dims[1]:.1f} m tall, depth {dims[2]:.1f} m "
          f"| {nholds} holds measured")

    img = cv2.cvtColor(cv2.imread(os.path.join(ROOT, "data", "bh", f"{args.ref}.jpg")), cv2.COLOR_BGR2RGB)
    fig, (axL, axR) = plt.subplots(1, 2, figsize=(15, 6))
    axL.imshow(img); axL.axis("off"); axL.set_title(f"original photo (bh/{args.ref})", fontsize=12)
    axR.scatter(Ps[lab == 0, 0], Ps[lab == 0, 2], s=2, c="tab:blue", label="face 1")
    axR.scatter(Ps[lab == 1, 0], Ps[lab == 1, 2], s=2, c="tab:orange", label="face 2")
    axR.set_title(f"reconstructed geometry — top-down (X-Z)\nfold {angle:.0f}°  ·  "
                  f"wall ~{dims[0]:.1f} m wide × {dims[1]:.1f} m tall  (scale anchored to {args.assumed*100:.0f} cm holds)",
                  fontsize=11)
    axR.set_xlabel("X — along wall (m)"); axR.set_ylabel("Z — depth (m)")
    axR.invert_yaxis(); axR.axis("equal"); axR.legend(loc="upper right")
    fig.tight_layout()
    out = os.path.join(HERE, f"{args.wall}_photo_vs_geometry.png")
    fig.savefig(out, dpi=100)
    print("saved", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
