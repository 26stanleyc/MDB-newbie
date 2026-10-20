"""Wall geometry from a dedicated surface-normal model (Marigold Normals, MPS).

A normal model predicts per-pixel surface orientation directly (not via noisy depth
differentiation), so the large wall panels come out clean and separable. Segmenting
the bare wall by normal gives each panel's orientation; with a gravity vector that
becomes the panel's angle vs true vertical (slab / vertical / overhang).

Single image in → wall panels + angles out. The only extra ingredient for an
*absolute* angle is gravity, captured automatically at the shutter in the real app
(M2 CaptureMeta); for these EXIF-less dataset images we simulate it.
"""

from __future__ import annotations

import cv2
import numpy as np

_PIPE = None
_MODEL = "prs-eth/marigold-normals-v0-1"


def _pipe():
    global _PIPE
    if _PIPE is None:
        import torch
        from diffusers import MarigoldNormalsPipeline
        dev = "mps" if torch.backends.mps.is_available() else (
            "cuda" if torch.cuda.is_available() else "cpu")
        _PIPE = MarigoldNormalsPipeline.from_pretrained(_MODEL, dtype=torch.float32).to(dev)
    return _PIPE


def normal_map(bgr: np.ndarray, steps: int = 4, resolution: int = 768,
               ensemble: int = 1) -> np.ndarray:
    """Per-pixel unit surface normals (H, W, 3), camera frame, oriented toward camera.

    `ensemble` averages several stochastic predictions for a smoother, less noisy
    normal field (slower). `resolution` is the model's processing size.
    """
    from PIL import Image
    img = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    out = _pipe()(img, num_inference_steps=steps, ensemble_size=ensemble,
                  processing_resolution=resolution)
    n = np.asarray(out.prediction)[0].astype(np.float32)   # (H, W, 3) in [-1, 1]
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    # Orient so the camera-facing component is consistent (z toward camera = negative).
    flip = n[..., 2] > 0
    n[flip] *= -1
    return n


def smooth_normals(n: np.ndarray, sigma: float = 9.0) -> np.ndarray:
    """Edge-preserving-ish denoise: Gaussian-blur the normal field + renormalize.

    Panels are large so their orientation survives; speckle noise is removed.
    """
    s = cv2.GaussianBlur(n, (0, 0), sigmaX=sigma, sigmaY=sigma)
    s /= np.linalg.norm(s, axis=-1, keepdims=True) + 1e-9
    return s


def angle_between(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(abs(a @ b), 0, 1))))


def angle_from_vertical(normal: np.ndarray, gravity_cam: np.ndarray) -> float:
    """+ overhang / - slab, vs true vertical. A vertical wall's normal is ⊥ gravity."""
    g = gravity_cam / (np.linalg.norm(gravity_cam) + 1e-9)
    n = normal / (np.linalg.norm(normal) + 1e-9)
    # component of (camera-facing) normal along 'down' → overhang leans over the climber
    return float(np.degrees(np.arcsin(np.clip(n @ g, -1, 1))))
