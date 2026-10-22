"""Robust wall-fold detector — clusters surface NORMALS, not position planes.

The old two-plane RANSAC fit a plane to the dominant face then a second plane to the
leftover points; a gradual prow's second face is < 10% of points, so it was missed
("flat"). This instead estimates a normal per point and clusters the normals: two
faces have two distinct orientations regardless of their point counts, so the fold
separates cleanly. Fold angle = angle between the two normal clusters; the crease
direction (their cross product) says vertical fold (prow) vs horizontal (cave tilt).

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/multiview/analyze_folds.py
"""

from __future__ import annotations

import glob
import os

import numpy as np
import trimesh
from sklearn.cluster import KMeans
from sklearn.neighbors import NearestNeighbors

FLAT_DEG = 8.0        # below this the wall is one face
MIN_FRACTION = 0.15   # each face must hold at least this share of points


def estimate_normals(P: np.ndarray, k: int = 24) -> np.ndarray:
    """Per-point normals via local PCA (smallest-eigenvector of the neighbor cov)."""
    nn = NearestNeighbors(n_neighbors=k).fit(P)
    _, idx = nn.kneighbors(P)
    nb = P[idx]                                  # (N, k, 3)
    c = nb - nb.mean(1, keepdims=True)
    cov = np.einsum('nki,nkj->nij', c, c) / k    # (N, 3, 3)
    w, v = np.linalg.eigh(cov)
    n = v[:, :, 0]                               # smallest eigenvalue -> normal
    # orient consistently toward the camera (negative z in the DUSt3R frame)
    flip = n[:, 2] > 0
    n[flip] *= -1
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)


def denoise(P: np.ndarray, keep: float = 0.9) -> np.ndarray:
    """Drop far outliers (floor/ceiling/flyaway points) by distance to k-th neighbor."""
    nn = NearestNeighbors(n_neighbors=8).fit(P)
    d, _ = nn.kneighbors(P)
    thr = np.quantile(d[:, -1], keep)
    return P[d[:, -1] <= thr]


def analyze(ply_path: str, sample: int = 40000):
    P = np.asarray(trimesh.load(ply_path).vertices, dtype=np.float32)
    rng = np.random.default_rng(0)
    if len(P) > sample:
        P = P[rng.choice(len(P), sample, replace=False)]
    P = denoise(P)
    n = estimate_normals(P)

    # Cluster by normal only to ASSIGN points to two faces (robust to point-count
    # ratio); then fit an actual plane to each face's points and measure the angle
    # between those plane normals (avoids the cluster-mean overestimate bias).
    km = KMeans(n_clusters=2, n_init=5, random_state=0).fit(n)
    frac = np.bincount(km.labels_, minlength=2) / len(n)

    def plane_normal(pts):
        pts = pts - pts.mean(0)
        _, _, vh = np.linalg.svd(pts, full_matrices=False)
        nrm = vh[-1]
        return nrm / (np.linalg.norm(nrm) + 1e-9)

    nrm0 = plane_normal(P[km.labels_ == 0])
    nrm1 = plane_normal(P[km.labels_ == 1])
    angle = float(np.degrees(np.arccos(np.clip(abs(nrm0 @ nrm1), 0, 1))))

    crease = np.cross(nrm0, nrm1)
    crease /= np.linalg.norm(crease) + 1e-9
    # vertical crease (prow) -> crease mostly along world-up (y); horizontal -> along x
    orient = 'vertical fold (prow/corner)' if abs(crease[1]) > abs(crease[0]) else 'horizontal fold (cave/tilt)'

    folded = angle >= FLAT_DEG and frac.min() >= MIN_FRACTION
    return {
        'angle': angle, 'frac': frac, 'folded': folded, 'orient': orient, 'n_pts': len(P),
    }


def main() -> int:
    plys = sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'clouds', '**', '*.ply'), recursive=True))
    print(f"{len(plys)} clouds\n")
    for ply in plys:
        name = os.path.basename(ply).replace('.ply', '')
        if name == 'wall_cloud':
            name = os.path.basename(os.path.dirname(ply))
        r = analyze(ply)
        verdict = f"FOLD {r['angle']:.0f} deg — {r['orient']}" if r['folded'] else f"~flat ({r['angle']:.0f} deg, below thresh)"
        print(f"  {name:12s} {r['n_pts']:>6} pts | faces {r['frac'][0]:.0%}/{r['frac'][1]:.0%} | {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
