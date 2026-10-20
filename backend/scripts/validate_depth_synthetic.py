"""Validate the M11 geometry pipeline on synthetic scenes with known answers.

No GPU, no DA3: we render metric depth maps for a wall + hemispherical holds of
known protrusion/footprint (and a tilted wall of known angle), run the full
pipeline, and check recovered values. This exercises intrinsics, back-projection,
plane fit, gravity-aligned hold frame, height map, and summary end-to-end.

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/validate_depth_synthetic.py
"""

from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

from pipeline.depth import (  # noqa: E402
    backproject,
    compute_intrinsics,
    fit_wall_plane,
    process_hold,
    process_scan,
    save_records,
    wall_angle_deg,
)

W, H = 1000, 750
FOCAL35 = 26.0
D = 2.0  # wall distance (m)
CHECKS: list[tuple[str, bool, str]] = []


def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))
    print(f"  [{'ok' if cond else 'XX'}] {name}  {detail}")


def render_frontoparallel(holds):
    """holds: list of (X0,Y0 world m, radius m). Returns depth, list of masks."""
    intr = compute_intrinsics(W, H, FOCAL35)
    us, vs = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    Xw = (us - intr.cx) * D / intr.fx
    Yw = (vs - intr.cy) * D / intr.fy
    depth = np.full((H, W), D, np.float32)
    masks = []
    for (X0, Y0, r) in holds:
        rho2 = (Xw - X0) ** 2 + (Yw - Y0) ** 2
        inside = rho2 < r * r
        depth[inside] = D - np.sqrt(np.maximum(r * r - rho2[inside], 0))
        masks.append(inside)
    return intr, depth, masks


def render_tilted(tilt_deg):
    intr = compute_intrinsics(W, H, FOCAL35)
    t = np.radians(tilt_deg)
    n = np.array([0.0, np.sin(t), -np.cos(t)])  # leans: +y(down) component = overhang
    d = -D * n[2]  # wall ~D at image center
    us, vs = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    dirs = np.stack([(us - intr.cx) / intr.fx, (vs - intr.cy) / intr.fy, np.ones_like(us)], -1)
    s = -d / (dirs @ n)
    depth = (s * dirs[..., 2]).astype(np.float32)
    return intr, depth, n


def main() -> int:
    gravity_cam = np.array([0.0, 1.0, 0.0])  # "down" is +y in camera frame

    # --- Case 1: fronto-parallel wall, three hemispheres of known protrusion ---
    print("Case 1 — fronto-parallel wall, known hemispheres:")
    holds = [(-0.3, -0.1, 0.05), (0.0, 0.1, 0.035), (0.35, 0.0, 0.02)]  # r = protrusion (m)
    intr, depth, masks = render_frontoparallel(holds)
    pts = backproject(depth, intr)
    any_hold = np.any(masks, axis=0)
    n, dd, noise = fit_wall_plane(pts, ~any_hold)
    check("wall distance ~2.0 m", abs(np.median(depth[~any_hold]) - D) < 0.02, f"d={D}")
    check("wall angle ~0deg (vertical)", abs(wall_angle_deg(n, gravity_cam)) < 2.0,
          f"got {wall_angle_deg(n, gravity_cam):.2f}")

    colors = np.zeros((H, W, 3), np.uint8)
    for (X0, Y0, r), mask in zip(holds, masks):
        rec, arr = process_hold(
            pts, colors, mask, n, dd, gravity_cam, noise, intr, "measured",
            hold_id="h", label="hold", color="blue", model_version="synthetic",
        )
        exp_prot = r * 1000
        got_prot = rec.summary.max_protrusion_mm
        got_fw = rec.summary.footprint_w_mm
        check(f"protrusion r={int(exp_prot)}mm", abs(got_prot - exp_prot) < max(3, 0.2 * exp_prot),
              f"got {got_prot:.1f}mm")
        check(f"footprint ~{int(2*exp_prot)}mm", abs(got_fw - 2 * exp_prot) < 0.25 * (2 * exp_prot),
              f"got {got_fw:.1f}mm")

    # --- Case 2: tilted walls, known angle ---
    print("Case 2 — tilted wall, known angle:")
    for tilt in (15.0, -20.0):
        intr, depth, n_true = render_tilted(tilt)
        pts = backproject(depth, intr)
        n, dd, noise = fit_wall_plane(pts, np.ones((H, W), bool))
        got = wall_angle_deg(n, gravity_cam)
        check(f"wall angle ~{tilt:+.0f}deg", abs(got - tilt) < 3.0, f"got {got:+.2f}")

    # --- Case 3: end-to-end process_scan + serialization round-trip ---
    print("Case 3 — process_scan + save/reload records:")
    import json
    intr, depth, masks = render_frontoparallel(holds)
    img = np.zeros((H, W, 3), np.uint8)
    hold_dicts = [
        {"id": f"h{i}", "mask": m, "label": "hold", "color": "blue"}
        for i, m in enumerate(masks)
    ]
    wall, records, arrays = process_scan(img, depth, hold_dicts, W, H, gravity_cam,
                                        focal35=FOCAL35, gravity_source="measured",
                                        model_version="synthetic")
    out = os.path.join(BACKEND, "artifacts", "depth", "synthetic")
    save_records(out, "synthetic-scan", wall, records, arrays)
    reloaded = json.load(open(os.path.join(out, "records.json")))
    npz = np.load(os.path.join(out, "arrays.npz"))
    check("3 records written", len(records) == 3, f"got {len(records)}")
    check("records.json has wall + holds",
          "wall_surface" in reloaded and len(reloaded["holds"]) == 3)
    check("arrays.npz has height maps", any(k.endswith("__height_map") for k in npz.files))
    check("records carry confidence + provenance",
          all("confidence" in h and h["model_version"] == "synthetic" for h in reloaded["holds"]))

    passed = sum(1 for _, c, _ in CHECKS if c)
    print(f"\nM11 geometry validation: {passed}/{len(CHECKS)} ->",
          "PASS" if passed == len(CHECKS) else "FAIL")
    return 0 if passed == len(CHECKS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
