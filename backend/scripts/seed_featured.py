"""Seed a few training walls as featured scans — the starter set every app shows in
Saved walls. Talks to the running server (so walls are processed like real scans);
idempotent: walls already seeded (same source image) are skipped.

Run from the parent "rock climbing" folder with the server running:
    ./.venv/bin/python backend/scripts/seed_featured.py
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
import uuid

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SERVER = os.environ.get("CAPITAN_SERVER", "http://localhost:8000")

# (image, gym name). Mosaic Boulders = the user's gym; bh = the labeled dataset gym.
WALLS = [
    ("data/mosaic/m13.jpg", "Mosaic Boulders"),
    ("data/mosaic/m04.jpg", "Mosaic Boulders"),
    ("data/mosaic/m05.jpg", "Mosaic Boulders"),
    ("data/mosaic/m07.jpg", "Mosaic Boulders"),
    ("data/bh/0075.jpg", "Sample gym (training data)"),
    ("data/bh/0917.jpg", "Sample gym (training data)"),
]
UPLOAD_WIDTH = 1600  # same as the app's prepareImage


def call(method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    req = urllib.request.Request(SERVER + path, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def place_id(name: str) -> str:
    hits = [p for p in call("GET", "/places/search?q=" + urllib.parse.quote(name)) if p["name"] == name]
    if hits:
        return hits[0]["id"]
    body = json.dumps({"name": name}).encode()
    return call("POST", "/places", body, {"Content-Type": "application/json"})["id"]


def multipart(fields: dict, image_name: str, image: bytes) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="images"; filename="{image_name}"\r\n'
                 f"Content-Type: image/jpeg\r\n\r\n".encode() + image + b"\r\n")
    return b"".join(parts) + f"--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}"


def main() -> int:
    existing = {s["scanId"] for s in call("GET", "/scans/featured")}
    seeded_sources = set()
    store = os.path.join(ROOT, "backend", "store", "scans")
    for sid in existing:
        path = os.path.join(store, sid, "scan.json")
        if os.path.exists(path):
            seeded_sources.add(json.load(open(path)).get("source"))
    for image_path, gym in WALLS:
        if image_path in seeded_sources:
            print(f"skip {image_path} (already seeded)")
            continue
        img = cv2.imread(os.path.join(ROOT, image_path))
        h, w = img.shape[:2]
        if w > UPLOAD_WIDTH:
            img = cv2.resize(img, (UPLOAD_WIDTH, round(h * UPLOAD_WIDTH / w)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        meta = [{"originalWidth": w, "originalHeight": h, "uploadWidth": img.shape[1], "uploadHeight": img.shape[0]}]
        body, ctype = multipart({"placeId": place_id(gym), "metas": json.dumps(meta), "mode": "quick",
                                 "featured": "true", "source": image_path}, os.path.basename(image_path), buf.tobytes())
        sid = call("POST", "/scans", body, {"Content-Type": ctype})["scanId"]
        for _ in range(120):
            if call("GET", f"/scans/{sid}")["status"] != "processing":
                break
            time.sleep(1)
        s = call("GET", f"/scans/{sid}")
        print(f"seeded {image_path} -> {sid} ({gym}): {s['status']}, {len(s['holds'])} holds, {len(s['routes'])} routes")
    print(f"featured walls: {len(call('GET', '/scans/featured'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
