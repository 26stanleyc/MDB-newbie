"""Capitan backend server — implements the app's CapitanApi contract over HTTP.

Runs locally on the Mac; the phone reaches it over Wi-Fi. Every upload and every
correction is saved under backend/store/ — that is the training corpus.

Run from the parent "rock climbing" folder:
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/uvicorn --app-dir backend server.app:app --host 0.0.0.0 --port 8000

Auth is intentionally not here: the app keeps its local mock sign-in until real
accounts are designed.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from pipeline.places import Place, PlaceRegistry, haversine_m  # noqa: E402
from pipeline.quality import check_image_quality  # noqa: E402
from pipeline.scan import group_routes, plan_route, process_image  # noqa: E402

STORE = os.environ.get("CAPITAN_STORE", os.path.join(BACKEND, "store"))
SCANS_DIR = os.path.join(STORE, "scans")
PLACES_FILE = os.path.join(STORE, "places.json")

# Same gyms the app's fixtures list, so the place picker isn't empty on day one.
# No coordinates: a gym gets real coords when someone creates/scans it on site.
SEED_PLACES = [
    ("place-mc", "Mission Cliffs"), ("place-db", "Dogpatch Boulders"),
    ("place-mb", "Movement Presidio"), ("place-gw", "GreatWall Berkeley"),
    ("place-bp", "Bridges Rock Gym"),
]
PUBLIC_SCAN_FIELDS = ("id", "placeId", "createdAt", "status", "holds", "routes")

app = FastAPI(title="Capitan backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lock = threading.RLock()
_worker = ThreadPoolExecutor(max_workers=1)  # one model, one scan at a time
scans: dict[str, dict] = {}
registry = PlaceRegistry()


# --- persistence -------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _scan_dir(scan_id: str) -> str:
    return os.path.join(SCANS_DIR, scan_id)


def _save_scan(scan: dict) -> None:
    path = os.path.join(_scan_dir(scan["id"]), "scan.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(scan, f)
    os.replace(tmp, path)


def _log(scan_id: str, name: str, record: dict) -> None:
    """Append a labeled-data record (corrections etc.) to the scan's jsonl log."""
    with open(os.path.join(_scan_dir(scan_id), f"{name}.jsonl"), "a") as f:
        f.write(json.dumps({"at": _now(), **record}) + "\n")


def _save_places() -> None:
    with open(PLACES_FILE, "w") as f:
        json.dump({"next": registry._next, "places": [vars(p) for p in registry.places]}, f)


def _load() -> None:
    os.makedirs(SCANS_DIR, exist_ok=True)
    if os.path.exists(PLACES_FILE):
        data = json.load(open(PLACES_FILE))
        registry.places = [Place(**p) for p in data["places"]]
        registry._next = data["next"]
    else:
        registry.places = [Place(id=pid, name=name) for pid, name in SEED_PLACES]
        _save_places()
    for scan_id in os.listdir(SCANS_DIR):
        path = os.path.join(SCANS_DIR, scan_id, "scan.json")
        if os.path.exists(path):
            scans[scan_id] = json.load(open(path))
    for scan in scans.values():  # server restarted mid-processing → redo
        if scan["status"] == "processing":
            _worker.submit(_process, scan["id"])


# --- helpers -----------------------------------------------------------------

def _decode(data: bytes) -> np.ndarray:
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(400, "Could not read the image.")
    return bgr


def _get_scan(scan_id: str) -> dict:
    scan = scans.get(scan_id)
    if not scan:
        raise HTTPException(404, f"Scan {scan_id} not found")
    return scan


def _get_route(scan: dict, route_id: str) -> dict:
    route = next((r for r in scan["routes"] if r["id"] == route_id), None)
    if not route:
        raise HTTPException(404, f"Route {route_id} not found")
    return route


def _public(scan: dict, request: Request) -> dict:
    out = {k: scan[k] for k in PUBLIC_SCAN_FIELDS}
    out["imageUri"] = str(request.url_for("scan_image", scan_id=scan["id"]))
    return out


def _place_out(p: Place, lat: float | None = None, lng: float | None = None) -> dict:
    out = {"id": p.id, "name": p.name, "scanCount": sum(1 for s in scans.values() if s["placeId"] == p.id)}
    if lat is not None and lng is not None and p.lat is not None and p.lng is not None:
        out["distanceM"] = round(haversine_m(lat, lng, p.lat, p.lng))
    return out


def _process(scan_id: str) -> None:
    scan = scans[scan_id]
    try:
        t0 = time.time()
        with open(os.path.join(_scan_dir(scan_id), "view_0.jpg"), "rb") as f:
            result = process_image(_decode(f.read()), scan_id)
        with _lock:
            scan.update(result, status="done", processingSec=round(time.time() - t0, 2))
            _save_scan(scan)
    except Exception:
        traceback.print_exc()
        with _lock:
            scan.update(status="failed", error=traceback.format_exc(limit=3))
            _save_scan(scan)


# --- endpoints ---------------------------------------------------------------

class Profile(BaseModel):
    heightCm: float
    wingspanCm: float


class PathCorrectionBody(BaseModel):
    steps: list[dict]
    profile: Profile


class GradeBody(BaseModel):
    grade: str


class CorrectionsBody(BaseModel):
    corrections: list[dict]


class PlaceBody(BaseModel):
    name: str
    lat: float | None = None
    lng: float | None = None


@app.on_event("startup")
def startup() -> None:
    _load()


@app.get("/health")
def health() -> dict:
    return {"ok": True, "scans": len(scans)}


@app.post("/quality")
async def quality(image: UploadFile = File(...)) -> dict:
    r = check_image_quality(_decode(await image.read()))
    return {"ok": True} if r.ok else {"ok": False, "reason": r.reason, "message": r.message}


@app.post("/scans")
async def create_scan(
    images: list[UploadFile] = File(...),
    placeId: str = Form(...),
    metas: str = Form("[]"),
    mode: str = Form("quick"),
) -> dict:
    scan_id = f"scan-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
    os.makedirs(_scan_dir(scan_id))
    for i, img in enumerate(images):
        with open(os.path.join(_scan_dir(scan_id), f"view_{i}.jpg"), "wb") as f:
            f.write(await img.read())
    scan = {
        "id": scan_id, "placeId": placeId, "createdAt": _now(), "status": "processing",
        "holds": [], "routes": [], "mode": mode, "views": len(images),
        "captureMeta": json.loads(metas), "pathOverrides": {},
    }
    with _lock:
        scans[scan_id] = scan
        _save_scan(scan)
    _worker.submit(_process, scan_id)
    return {"scanId": scan_id}


@app.get("/scans/{scan_id}")
def get_scan(scan_id: str, request: Request) -> dict:
    return _public(_get_scan(scan_id), request)


@app.get("/scans/{scan_id}/image", name="scan_image")
def scan_image(scan_id: str):
    _get_scan(scan_id)
    return FileResponse(os.path.join(_scan_dir(scan_id), "view_0.jpg"), media_type="image/jpeg")


def _path_key(route_id: str, p: Profile) -> str:
    return f"{route_id}:{p.heightCm:g}:{p.wingspanCm:g}"


@app.post("/scans/{scan_id}/routes/{route_id}/path")
def optimal_path(scan_id: str, route_id: str, profile: Profile) -> list[dict]:
    scan = _get_scan(scan_id)
    route = _get_route(scan, route_id)
    override = scan["pathOverrides"].get(_path_key(route_id, profile))
    if override:  # a climber's correction wins until the path model learns from it
        return override
    return plan_route(route, scan["geom"], scan["imageSize"], profile.heightCm, profile.wingspanCm)


@app.post("/scans/{scan_id}/routes/{route_id}/path-correction")
def path_correction(scan_id: str, route_id: str, body: PathCorrectionBody) -> list[dict]:
    scan = _get_scan(scan_id)
    _get_route(scan, route_id)
    steps = [{**s, "order": i + 1} for i, s in enumerate(body.steps)]
    with _lock:
        scan["pathOverrides"][_path_key(route_id, body.profile)] = steps
        _save_scan(scan)
        _log(scan_id, "path_corrections", {"routeId": route_id, "profile": body.profile.model_dump(), "steps": steps})
    return steps


@app.post("/routes/{route_id}/grade")
def grade(route_id: str, body: GradeBody) -> dict:
    with _lock:
        for scan in scans.values():
            route = next((r for r in scan["routes"] if r["id"] == route_id), None)
            if route:
                votes = route.get("communityGrade", {}).get("votes", 0) + 1
                route["communityGrade"] = {"grade": body.grade, "votes": votes}
                _save_scan(scan)
                _log(scan["id"], "grades", {"routeId": route_id, "grade": body.grade})
                return route
    raise HTTPException(404, f"Route {route_id} not found")


@app.post("/scans/{scan_id}/corrections")
def corrections(scan_id: str, body: CorrectionsBody, request: Request) -> dict:
    scan = _get_scan(scan_id)
    if scan["status"] != "done":
        raise HTTPException(409, "Scan is not done processing")
    with _lock:
        W, H = scan["imageSize"]
        for c in body.corrections:
            if c["kind"] == "recolor":
                for h in scan["holds"]:
                    if h["id"] == c["holdId"]:
                        h["color"] = c["newColor"]
            elif c["kind"] == "delete":
                scan["holds"] = [h for h in scan["holds"] if h["id"] != c["holdId"]]
                scan["geom"].pop(c["holdId"], None)
            elif c["kind"] == "add":
                tl, br = c["box"]["topLeft"], c["box"]["bottomRight"]
                hid = f"{scan_id}-add-{uuid.uuid4().hex[:5]}"
                scan["holds"].append({
                    "id": hid, "color": c["color"], "confidence": 1.0,
                    "polygon": [tl, {"x": br["x"], "y": tl["y"]}, br, {"x": tl["x"], "y": br["y"]}],
                })
                scan["geom"][hid] = {
                    "center": {"x": (tl["x"] + br["x"]) / 2, "y": (tl["y"] + br["y"]) / 2},
                    "longPx": max(abs(br["x"] - tl["x"]) * W, abs(br["y"] - tl["y"]) * H),
                    "kind": "hold",
                }
        scan["routes"] = group_routes(scan["holds"], scan_id, scan["routes"])
        _save_scan(scan)
        _log(scan_id, "hold_corrections", {"corrections": body.corrections})
    return _public(scan, request)


@app.get("/places/nearby")
def nearby(lat: float, lng: float) -> list[dict]:
    return [_place_out(p, lat, lng) for p in registry.get_nearby(lat, lng)]


@app.get("/places/search")
def search(q: str) -> list[dict]:
    return [_place_out(p) for p in registry.search(q)]


@app.post("/places")
def create_place(body: PlaceBody) -> dict:
    with _lock:
        p = registry.create_place(body.name, body.lat, body.lng)
        _save_places()
    return _place_out(p, body.lat, body.lng)


@app.get("/places/{place_id}/scans")
def place_scans(place_id: str, request: Request) -> list[dict]:
    found = [s for s in scans.values() if s["placeId"] == place_id]
    found.sort(key=lambda s: s["createdAt"], reverse=True)
    return [_public(s, request) for s in found]
