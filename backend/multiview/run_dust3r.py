"""Multi-view 3D wall reconstruction with DUSt3R (learned, no COLMAP).

Feeds two (or more) overlapping views of the SAME wall into DUSt3R, which outputs
globally-aligned 3D point maps. We then fit wall planes to the reconstruction and
measure the angle between them — the fold that single-view normals couldn't resolve.

The gym dataset already contains multi-view of the same walls (e.g. bh/0310 & 0526),
so this needs no new capture.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/multiview/run_dust3r.py --images data/bh/0310.jpg data/bh/0526.jpg
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DUST3R = os.path.join(HERE, "dust3r")
sys.path.insert(0, DUST3R)
sys.path.insert(0, os.path.join(DUST3R, "croco"))

OUT = os.path.join(HERE, "out")
WEIGHTS = "naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt"


def pick_device(pref="auto"):
    import torch
    if pref != "auto":
        return pref
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def fit_plane(pts, iters=400, thresh=0.02, rng=None):
    """RANSAC plane fit → (normal, d). Subsamples for speed; SVD uses
    full_matrices=False (otherwise numpy builds an N×N U matrix on big inputs)."""
    rng = rng or np.random.default_rng(0)
    fit = pts if len(pts) <= 120000 else pts[rng.choice(len(pts), 120000, replace=False)]
    best_in, best = None, None
    for _ in range(iters):
        idx = rng.choice(len(fit), 3, replace=False)
        p = fit[idx]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        nn = np.linalg.norm(n)
        if nn < 1e-9:
            continue
        n = n / nn
        d = -n @ p[0]
        inl = np.abs(fit @ n + d) < thresh
        if best_in is None or inl.sum() > best_in.sum():
            best_in, best = inl, (n, d)
    n, d = best
    c = fit[best_in].mean(0)
    _, _, vh = np.linalg.svd(fit[best_in] - c, full_matrices=False)  # (k,3), fast
    n = vh[-1]
    n /= np.linalg.norm(n) + 1e-9
    return n, float(-n @ c)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", nargs="+", required=True)
    ap.add_argument("--niter", type=int, default=300)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--device", default="auto", help="auto|cpu|mps|cuda")
    args = ap.parse_args()

    import torch
    from dust3r.cloud_opt import GlobalAlignerMode, global_aligner
    from dust3r.image_pairs import make_pairs
    from dust3r.inference import inference
    from dust3r.model import AsymmetricCroCo3DStereo
    from dust3r.utils.image import load_images

    os.makedirs(OUT, exist_ok=True)
    device = pick_device(args.device)
    print(f"device: {device} | loading DUSt3R (downloads ~2.3 GB first time)...")
    model = AsymmetricCroCo3DStereo.from_pretrained(WEIGHTS).to(device)

    images = load_images(args.images, size=args.size)
    pairs = make_pairs(images, scene_graph="complete", prefilter=None, symmetrize=True)
    print(f"{len(images)} images, {len(pairs)} pairs -> inference")
    output = inference(pairs, model, device, batch_size=1)

    # Free the ~2.6 GB model before alignment + post-processing to avoid OOM (SIGKILL).
    import gc
    del model
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()

    scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
    loss = scene.compute_global_alignment(init="mst", niter=args.niter, schedule="cosine", lr=0.01)
    print(f"global alignment loss: {float(loss):.4f}")

    with torch.no_grad():
        pts3d = [p.detach().cpu().numpy() for p in scene.get_pts3d()]
        confs = [c.detach().cpu().numpy() for c in scene.get_conf()]
        focals = [float(f) for f in scene.get_focals().detach().cpu().numpy().ravel()]
        imgs_np = [im for im in scene.imgs]
    del scene
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    print(f"estimated focals (px): {[round(f,1) for f in focals]}")

    # Combine confident points from all views into one cloud.
    pts, cols = [], []
    for p, c, im in zip(pts3d, confs, imgs_np):
        m = c > np.percentile(c, 40)
        pts.append(p[m])
        cols.append((im[m] * 255).astype(np.uint8))
    P = np.concatenate(pts); C = np.concatenate(cols)
    print(f"reconstructed {len(P):,} 3D points")

    # Fit the dominant wall plane, then a 2nd plane on the residual → the fold.
    n1, d1 = fit_plane(P)
    in1 = np.abs(P @ n1 + d1) < 0.02
    rest = P[~in1]
    report = [("plane 1", n1, int(in1.sum()))]
    if len(rest) > 2000:
        n2, d2 = fit_plane(rest)
        in2 = np.abs(rest @ n2 + d2) < 0.02
        if in2.sum() > 0.1 * len(P):
            ang = float(np.degrees(np.arccos(np.clip(abs(n1 @ n2), 0, 1))))
            report.append(("plane 2", n2, int(in2.sum())))
            print(f"\nFOLD: plane-1 vs plane-2 angle = {ang:.1f} deg")
    print("planes:")
    for name, n, cnt in report:
        print(f"  {name}: normal=({n[0]:+.2f},{n[1]:+.2f},{n[2]:+.2f}) | {cnt:,} pts")

    # Save point cloud (view in MeshLab/CloudCompare) + a side-profile render.
    try:
        import trimesh
        trimesh.PointCloud(P, colors=C).export(os.path.join(OUT, "wall_cloud.ply"))
        print(f"saved {OUT}/wall_cloud.ply")
    except Exception as e:
        print("ply export skipped:", e)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    sub = P[np.random.default_rng(0).choice(len(P), min(40000, len(P)), replace=False)]
    fig, axs = plt.subplots(1, 2, figsize=(14, 6))
    axs[0].scatter(sub[:, 0], sub[:, 2], s=1, c=sub[:, 1], cmap="viridis")
    axs[0].set_title("top-down (X-Z): fold shows as a bend"); axs[0].set_xlabel("X"); axs[0].set_ylabel("Z (depth)")
    axs[0].axis("equal")
    axs[1].scatter(sub[:, 0], -sub[:, 1], s=1, c=sub[:, 2], cmap="magma")
    axs[1].set_title("front (X-Y)"); axs[1].set_xlabel("X"); axs[1].set_ylabel("Y (up)")
    axs[1].axis("equal")
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "wall_profile.png"), dpi=90)
    print(f"saved {OUT}/wall_profile.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
