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

from .beta import FEATURES, Hold as BetaHold, Reach, load_weights, path_features, plan_beta
from .holds import EVAL_MAX_SIDE, build_model
from .people import drop_people, person_mask
from .routes import ColorNamer, classify_and_group, hold_color_lab, hold_lab, linear_exposure

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CKPT = os.path.join(BACKEND, "artifacts", "m9_maskrcnn.pt")

SCORE_MIN = 0.5            # detections below this are dropped
MAX_DETECTIONS = 400       # walls carry up to ~325 holds
ASSUMED_HOLD_M = 0.14      # average hold's longest side (metric scale anchor, see scale_from_holds.py)
WALL_M_RANGE = (2.0, 10.0) # clamp the implied image height to something wall-sized
FALLBACK_WALL_M = 4.5      # image height if there are too few holds to anchor on
ROUTE_LINK_M = 1.2         # same-color holds farther apart than a tall climber's move are separate routes
TAP_MAX_DROP_M = 0.6       # tap-to-pick: footholds may sit this far below the start hold
TAP_MAX_SIDE_M = 1.25      # tap-to-pick: route stays within this lateral distance of the start hold

PLANNER_WEIGHTS = load_weights()  # learned from Claude's preferences when available

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


def working_image(bgr: np.ndarray) -> np.ndarray:
    """Downscale to the detector's working resolution (long side <= EVAL_MAX_SIDE)."""
    h, w = bgr.shape[:2]
    scale = min(1.0, EVAL_MAX_SIDE / max(h, w))
    return cv2.resize(bgr, (round(w * scale), round(h * scale))) if scale < 1 else bgr


def detection_from_mask(mask: np.ndarray, score: float, kind: str) -> dict | None:
    """Polygon (normalized), confidence, kind, center (normalized), long_px, mask."""
    H, W = mask.shape
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnt = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 1.5, True).reshape(-1, 2)
    if len(cnt) < 3:
        return None
    x, y, bw, bh = cv2.boundingRect(cnt)
    m = cv2.moments(cnt)
    cx, cy = (m["m10"] / m["m00"], m["m01"] / m["m00"]) if m["m00"] else (x + bw / 2, y + bh / 2)
    return {
        "polygon": [{"x": float(px / W), "y": float(py / H)} for px, py in cnt],
        "confidence": float(score),
        "kind": kind,
        "center": {"x": float(cx / W), "y": float(cy / H)},
        "long_px": float(max(bw, bh)),
        "mask": mask,
    }


def detect_holds(img: np.ndarray, model=None) -> list[dict]:
    """Run the hold detector on a working-resolution BGR image."""
    if model is None:
        model, device = _get_model()
    else:
        device = next(model.parameters()).device
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    tensor = torch.as_tensor(rgb.transpose(2, 0, 1), dtype=torch.float32) / 255.0
    with _lock, torch.no_grad():
        out = model([tensor.to(device)])[0]

    dets = []
    masks = (out["masks"].squeeze(1).cpu().numpy() > 0.5)
    for mask, score, label in zip(masks, out["scores"].cpu().numpy(), out["labels"].cpu().numpy()):
        if score < SCORE_MIN or not mask.any():
            continue
        d = detection_from_mask(mask, float(score), "volume" if int(label) == 2 else "hold")
        if d:
            dets.append(d)
    return dets


_namer: ColorNamer | None = None
_namer_loaded = False


def default_namer() -> ColorNamer | None:
    """The app's color namer (artifacts/color_refs.npz, built by build_color_refs.py)."""
    global _namer, _namer_loaded
    if not _namer_loaded:
        _namer, _namer_loaded = ColorNamer.load(), True
        if _namer is None:
            print("WARNING: no artifacts/color_refs.npz — using the palette color rule. "
                  "Run backend/scripts/build_color_refs.py.", flush=True)
    return _namer


def build_scan(img: np.ndarray, dets: list[dict], id_prefix: str, namer: ColorNamer | None | bool = None) -> dict:
    """Color stage: holds → named colors → one route per color.
    namer: None = the app's default; False = force the old palette rule.
    Returns {'holds', 'routes', 'geom', 'imageSize'}."""
    H, W = img.shape[:2]
    namer = default_namer() if namer is None else (namer or None)

    if namer is not None:
        lin = linear_exposure(img, np.any([d["mask"] for d in dets], axis=0) if dets else np.zeros((H, W), bool))
        kept, names = [], []
        for d in dets:
            lab = hold_lab(lin, d["mask"])
            if lab is not None:
                kept.append(d)
                names.append(namer.name(lab))
    else:  # no labeled references yet → palette rule
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

    return {"holds": holds, "routes": group_routes(holds, id_prefix, geom=geom, image_size=[W, H]),
            "geom": geom, "imageSize": [W, H]}


def analyze_scan(bgr: np.ndarray, scan: dict, gravity: dict | None = None) -> dict:
    """Second phase (pipeline/analysis.py): per-hold quality + grip point and wall
    angles. Returns {'geom': {hid: extra fields}, 'wall': {...}} to merge into a scan."""
    from .analysis import hold_quality, wall_angles
    from .wall_normals import normal_map

    W, H = scan["imageSize"]
    full_h, full_w = bgr.shape[:2]
    mpp = meters_per_pixel(scan["geom"], scan["imageSize"])  # meters per working-image pixel
    extra, masks = {}, {}
    for h in scan["holds"]:
        g = scan["geom"][h["id"]]
        poly = np.array([[p["x"], p["y"]] for p in h["polygon"]], np.float32)
        extra[h["id"]] = hold_quality(bgr, poly * [full_w, full_h], g["longPx"] * mpp * 100, g["kind"])
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [np.round(poly * [W, H]).astype(np.int32)], 1)
        masks[h["id"]] = m.astype(bool)
    normals = normal_map(working_image(bgr), toward_camera=True)
    if normals.shape[:2] != (H, W):
        normals = cv2.resize(normals, (W, H))
    angles = wall_angles(normals, masks, gravity)
    for hid, a in angles["holds"].items():
        extra[hid].update(a)
    return {"geom": extra, "wall": angles["wall"]}


def process_image(bgr: np.ndarray, id_prefix: str) -> dict:
    """Full scan processing: detect → drop holds that are people → color routes."""
    img = working_image(bgr)
    return build_scan(img, drop_people(detect_holds(img), person_mask(img)), id_prefix)


def group_routes(holds: list[dict], id_prefix: str, previous: list[dict] | None = None,
                 geom: dict | None = None, image_size: list[int] | None = None) -> list[dict]:
    """Holds → routes: same color AND chained within ROUTE_LINK_M of each other, so two
    same-colored routes on one wall stay separate. Without geometry: one route per color.
    Existing routes (after corrections) keep their id/name/grade by best hold overlap."""
    by_color: dict[str, list[str]] = {}
    for h in holds:
        by_color.setdefault(h["color"], []).append(h["id"])

    groups: list[tuple[str, list[str]]] = []
    for color, ids in by_color.items():
        comps = _spatial_components(ids, geom, image_size) if geom and image_size else [ids]
        groups += [(color, c) for c in sorted(comps, key=len, reverse=True)]

    prev = list(previous or [])
    used: set[str] = set()
    routes, count = [], {}
    for color, ids in groups:
        count[color] = count.get(color, 0) + 1
        n = count[color]
        old = max((r for r in prev if r["color"] == color and r["id"] not in used),
                  key=lambda r: len(set(r["holdIds"]) & set(ids)), default=None)
        if old is not None and not set(old["holdIds"]) & set(ids):
            old = None
        if old is not None:
            used.add(old["id"])
        route = {
            "id": old["id"] if old else f"{id_prefix}-{color}" + (f"-{n}" if n > 1 else ""),
            "color": color,
            "displayName": old["displayName"] if old else color.capitalize() + (f" {n}" if n > 1 else ""),
            "holdIds": ids,
        }
        if old and old.get("communityGrade"):
            route["communityGrade"] = old["communityGrade"]
        routes.append(route)
    # biggest routes first; stray one- or two-hold fragments sink to the bottom of the list
    return sorted(routes, key=lambda r: len(r["holdIds"]), reverse=True)


def _spatial_components(ids: list[str], geom: dict, image_size: list[int]) -> list[list[str]]:
    """Single-linkage components of hold centers with links <= ROUTE_LINK_M (meters)."""
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    pts = np.array([[geom[i]["center"]["x"] * W * mpp, geom[i]["center"]["y"] * H * mpp] for i in ids])
    parent = list(range(len(ids)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a in range(len(ids)):
        for b in range(a + 1, len(ids)):
            if np.linalg.norm(pts[a] - pts[b]) <= ROUTE_LINK_M:
                parent[find(a)] = find(b)
    comps: dict[int, list[str]] = {}
    for k, i in enumerate(ids):
        comps.setdefault(find(k), []).append(i)
    return list(comps.values())


def suggest_route(holds: list[dict], geom: dict, image_size: list[int], start_id: str) -> list[str]:
    """Tap-to-pick: the route most likely starting at `start_id` — holds of the same
    color chained within ROUTE_LINK_M, staying in a corridor above the start (routes
    go up; on a dense wall a color alone links half the wall). Start hold first."""
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    color = next(h["color"] for h in holds if h["id"] == start_id)
    pos = {h["id"]: np.array([geom[h["id"]]["center"]["x"] * W * mpp, (1 - geom[h["id"]]["center"]["y"]) * H * mpp])
           for h in holds if h["color"] == color}
    sx, sy = pos[start_id]
    ok = {i for i, (x, y) in pos.items() if y >= sy - TAP_MAX_DROP_M and abs(x - sx) <= TAP_MAX_SIDE_M}
    route, frontier = [start_id], [start_id]
    seen = {start_id}
    while frontier:
        a = frontier.pop()
        for b in ok - seen:
            if np.linalg.norm(pos[a] - pos[b]) <= ROUTE_LINK_M:
                seen.add(b)
                route.append(b)
                frontier.append(b)
    return route


def meters_per_pixel(geom: dict, image_size: list[int]) -> float:
    """Metric scale from average hold size, clamped to a plausible wall height."""
    W, H = image_size
    sizes = [g["longPx"] for g in geom.values() if g["kind"] == "hold"]
    mpp = ASSUMED_HOLD_M / float(np.median(sizes)) if len(sizes) >= 3 else FALLBACK_WALL_M / H
    lo, hi = WALL_M_RANGE
    return float(np.clip(mpp, lo / H, hi / H))


# Alternative path styles for "pick the path you'd climb" (human preference data):
# the same planner with one priority pushed hard. Multipliers on PLANNER_WEIGHTS, in
# FEATURES order (move, dist, strain, bad_hold, down, lateral, strain2); then an added
# amount (strain2 is 0 by default, so "shorter moves" adds it).
PATH_STYLES = [
    ("recommended", "Suggested", [1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0]),
    ("fewer", "Fewer moves", [4, 1, 0.5, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0]),
    ("shorter", "Shorter moves", [0, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 3]),
    ("holds", "Best holds", [1, 1, 1, 5, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0]),
    ("straight", "Straighter", [1, 1, 1, 1, 1, 5, 1], [0, 0, 0, 0, 0, 0, 0]),
]
MAX_PATH_OPTIONS = 3


def _route_holds(route: dict, geom: dict, image_size: list[int]) -> list:
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    # x right, y up, in meters; hold quality from analyze_scan when available
    return [BetaHold(hid, np.array([geom[hid]["center"]["x"] * W * mpp, (1 - geom[hid]["center"]["y"]) * H * mpp]),
                     geom[hid].get("quality", 0.6)) for hid in route["holdIds"]]


def plan_options(route: dict, geom: dict, image_size: list[int], height_cm: float, wingspan_cm: float,
                 k: int = MAX_PATH_OPTIONS) -> list[dict]:
    """Up to k genuinely different betas, "Suggested" (the default planner) first. Each: id, label, steps,
    features (summed move features — what a preference fit learns from)."""
    holds = _route_holds(route, geom, image_size)
    if len(holds) < 2:
        return [{"id": "recommended", "label": "Suggested", "features": [0.0] * len(FEATURES),
                 "steps": plan_route(route, geom, image_size, height_cm, wingspan_cm)}]
    reach = Reach.from_body(height_cm, wingspan_cm)
    out, seen = [], set()
    for sid, label, mult, add in PATH_STYLES:
        w = PLANNER_WEIGHTS * np.array(mult, float) + np.array(add, float)
        steps, _ = plan_beta(holds, height_cm, wingspan_cm, weights=w)
        hands = tuple(s.hold_id for s in steps if s.limb in ("LH", "RH"))
        if hands in seen:
            continue
        seen.add(hands)
        out.append({"id": sid, "label": label,
                    "steps": [{"order": s.order, "holdId": s.hold_id, "limb": s.limb} for s in steps],
                    "features": [round(float(x), 4) for x in path_features(list(hands[1:]), holds, reach)]})
        if len(out) == k:
            break
    return out


def plan_route(route: dict, geom: dict, image_size: list[int], height_cm: float, wingspan_cm: float) -> list[dict]:
    """Personalized beta for one route → PathStep dicts."""
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    holds = []
    for hid in route["holdIds"]:
        c = geom[hid]["center"]
        # x right, y up, in meters
        # hold quality from analyze_scan when available; the planner's default otherwise
        holds.append(BetaHold(hid, np.array([c["x"] * W * mpp, (1 - c["y"]) * H * mpp]),
                              geom[hid].get("quality", 0.6)))
    if not holds:
        return []
    if len(holds) == 1:
        return [{"order": 1, "holdId": holds[0].id, "limb": "RH"}, {"order": 2, "holdId": holds[0].id, "limb": "LH"}]
    steps, _ = plan_beta(holds, height_cm, wingspan_cm, weights=PLANNER_WEIGHTS)
    return [{"order": s.order, "holdId": s.hold_id, "limb": s.limb} for s in steps]
