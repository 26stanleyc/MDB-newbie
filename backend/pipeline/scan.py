"""Per-scan pipeline the server runs: photo → holds (M9) → color routes (M10),
and personalized beta (M12) on a detected route.

Output shapes follow the app's API contract (rc/src/api/types.ts): polygons and
hold centers are in normalized 0–1 image coordinates.
"""

from __future__ import annotations

import os
import threading

import cv2
import numpy as np
import torch

from .beta import Hold as BetaHold, plan_beta
from .holds import EVAL_MAX_SIDE, build_model
from .routes import classify_and_group, hold_color_lab

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CKPT = os.path.join(BACKEND, "artifacts", "m9_maskrcnn.pt")

SCORE_MIN = 0.5            # detections below this are dropped
MAX_DETECTIONS = 400       # walls carry up to ~325 holds
ASSUMED_HOLD_M = 0.14      # average hold's longest side (metric scale anchor, see scale_from_holds.py)
WALL_M_RANGE = (2.0, 10.0) # clamp the implied image height to something wall-sized
FALLBACK_WALL_M = 4.5      # image height if there are too few holds to anchor on

_model = None
_device = None
_lock = threading.Lock()


def _get_model():
    global _model, _device
    with _lock:
        if _model is None:
            _device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
            model = build_model()
            model.roi_heads.detections_per_img = MAX_DETECTIONS
            state = torch.load(DEFAULT_CKPT, map_location="cpu")
            model.load_state_dict(state["model"])
            _model = model.to(_device).eval()
        return _model, _device


def detect_holds(bgr: np.ndarray) -> tuple[list[dict], tuple[int, int], np.ndarray]:
    """Run the hold detector. Returns (holds, (w, h), working image).

    Each hold: polygon (normalized), confidence, kind ('hold'|'volume'),
    center (normalized), long_px (longest side in working-image pixels), mask.
    """
    h, w = bgr.shape[:2]
    scale = min(1.0, EVAL_MAX_SIDE / max(h, w))
    img = cv2.resize(bgr, (round(w * scale), round(h * scale))) if scale < 1 else bgr
    H, W = img.shape[:2]

    model, device = _get_model()
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    tensor = torch.as_tensor(rgb.transpose(2, 0, 1), dtype=torch.float32) / 255.0
    with _lock, torch.no_grad():
        out = model([tensor.to(device)])[0]

    holds = []
    masks = (out["masks"].squeeze(1).cpu().numpy() > 0.5)
    for mask, score, label in zip(masks, out["scores"].cpu().numpy(), out["labels"].cpu().numpy()):
        if score < SCORE_MIN or not mask.any():
            continue
        cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(cnts, key=cv2.contourArea)
        cnt = cv2.approxPolyDP(cnt, 1.5, True).reshape(-1, 2)
        if len(cnt) < 3:
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        m = cv2.moments(cnt)
        cx, cy = (m["m10"] / m["m00"], m["m01"] / m["m00"]) if m["m00"] else (x + bw / 2, y + bh / 2)
        holds.append({
            "polygon": [{"x": float(px / W), "y": float(py / H)} for px, py in cnt],
            "confidence": float(score),
            "kind": "volume" if int(label) == 2 else "hold",
            "center": {"x": float(cx / W), "y": float(cy / H)},
            "long_px": float(max(bw, bh)),
            "mask": mask,
        })
    return holds, (W, H), img


def process_image(bgr: np.ndarray, id_prefix: str) -> dict:
    """Full scan processing. Returns {'holds', 'routes', 'geom', 'imageSize'}."""
    dets, (W, H), img = detect_holds(bgr)
    lab_img = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)

    kept, labs = [], []
    for d in dets:
        lab = hold_color_lab(img, d["mask"], lab_img)
        if lab is not None:
            kept.append(d)
            labs.append(lab)
    names, _ = classify_and_group(labs) if labs else ([], [])

    holds, geom = [], {}
    for i, (d, name) in enumerate(zip(kept, names)):
        hid = f"{id_prefix}-h{i}"
        holds.append({"id": hid, "polygon": d["polygon"], "color": name, "confidence": d["confidence"]})
        geom[hid] = {"center": d["center"], "longPx": d["long_px"], "kind": d["kind"]}

    return {"holds": holds, "routes": group_routes(holds, id_prefix), "geom": geom, "imageSize": [W, H]}


def group_routes(holds: list[dict], id_prefix: str, previous: list[dict] | None = None) -> list[dict]:
    """One route per color (the app's model), keeping ids/grades of existing routes."""
    by_color: dict[str, list[str]] = {}
    for h in holds:
        by_color.setdefault(h["color"], []).append(h["id"])
    prev = {r["color"]: r for r in previous or []}
    routes = []
    for color, ids in by_color.items():
        old = prev.get(color, {})
        route = {
            "id": old.get("id", f"{id_prefix}-{color}"),
            "color": color,
            "displayName": old.get("displayName", color.capitalize()),
            "holdIds": ids,
        }
        if old.get("communityGrade"):
            route["communityGrade"] = old["communityGrade"]
        routes.append(route)
    return routes


def meters_per_pixel(geom: dict, image_size: list[int]) -> float:
    """Metric scale from average hold size, clamped to a plausible wall height."""
    W, H = image_size
    sizes = [g["longPx"] for g in geom.values() if g["kind"] == "hold"]
    mpp = ASSUMED_HOLD_M / float(np.median(sizes)) if len(sizes) >= 3 else FALLBACK_WALL_M / H
    lo, hi = WALL_M_RANGE
    return float(np.clip(mpp, lo / H, hi / H))


def plan_route(route: dict, geom: dict, image_size: list[int], height_cm: float, wingspan_cm: float) -> list[dict]:
    """Personalized beta for one route → PathStep dicts."""
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    holds = []
    for hid in route["holdIds"]:
        c = geom[hid]["center"]
        # x right, y up, in meters
        holds.append(BetaHold(hid, np.array([c["x"] * W * mpp, (1 - c["y"]) * H * mpp])))
    if not holds:
        return []
    if len(holds) == 1:
        return [{"order": 1, "holdId": holds[0].id, "limb": "RH"}, {"order": 2, "holdId": holds[0].id, "limb": "LH"}]
    steps, _ = plan_beta(holds, height_cm, wingspan_cm)
    return [{"order": s.order, "holdId": s.hold_id, "limb": s.limb} for s in steps]
