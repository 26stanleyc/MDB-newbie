"""DA3 depth interface + the one GPU-bound step, isolated from the geometry.

The geometry pipeline (depth.py) consumes a metric depth map; *producing* that map
is the only part that needs a GPU. So this module defines:
  - the metric conversion + .npz schema shared by Colab (producer) and the local
    pipeline (consumer);
  - a lazy DA3 runner used only on the GPU side (imports torch/DA3 inside the call,
    so importing this module locally never requires them).
"""

from __future__ import annotations

import numpy as np

# DA3METRIC conversion (design doc §10 M11 step 2): metric depth (m) =
# focal_length_px * model_output / 300. Verify against the pinned DA3 docs on first
# real run; kept here so Colab and local agree.
DA3_METRIC_DIVISOR = 300.0


def metric_from_da3(raw_output: np.ndarray, focal_px: float) -> np.ndarray:
    return raw_output.astype(np.float32) * focal_px / DA3_METRIC_DIVISOR


def save_depth_npz(path, depth_m, scan_id, model_version, focal_px) -> None:
    np.savez_compressed(path, depth_m=depth_m.astype(np.float32), scan_id=scan_id,
                        model_version=model_version, focal_px=float(focal_px))


def load_depth_npz(path: str):
    z = np.load(path, allow_pickle=True)
    return z["depth_m"], {
        "scan_id": str(z["scan_id"]),
        "model_version": str(z["model_version"]),
        "focal_px": float(z["focal_px"]),
    }


def run_da3_metric(image, focal_px: float, model):
    """DA3METRIC-LARGE monocular → metric depth (meters). GPU-only.

    `model` is a loaded DepthAnything3 — see backend/colab:
        from depth_anything_3.api import DepthAnything3
        model = DepthAnything3.from_pretrained("depth-anything/DA3METRIC-LARGE").to("cuda")
    `image` is a path (string) or list-compatible input. Uses the official
    conversion metric = focal_px * net_output / 300.
    """
    pred = model.inference([image])
    raw = np.asarray(pred.depth[0])  # (H, W) net output
    return metric_from_da3(raw, focal_px)
