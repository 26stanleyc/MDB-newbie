"""Gym lookup with Google Places API (New) — Text Search.

Google has no climbing-gym place type, so we text-search "climbing gym" around the
phone's location and rank by distance, preferring climbing words in the name. The key
(GOOGLE_MAPS_API_KEY, from the repo's .env) never leaves the server.

Only minimal fields are requested (id, name, location, types, address). Results are
cached in memory for a day to limit calls; gyms are persisted in the PlaceRegistry
only when a scan actually uses them. Check Google's caching terms before launch.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from .places import haversine_m

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
DETAILS_URL = "https://places.googleapis.com/v1/places/{}"
FIELDS = "places.id,places.displayName,places.location,places.types,places.formattedAddress"
DETAIL_FIELDS = "id,displayName,location,types,formattedAddress"
SEARCH_RADIUS_M = 5000.0
SUGGEST_WITHIN_M = 200.0   # "You're at X?" only when this close (in-gym GPS is ~10–100 m off)
CACHE_TTL_S = 24 * 3600
CLIMBING_WORDS = ("climb", "boulder", "crag", "rock", "cliff", "wall", "vertical", "bloc", "escalade", "kletter")
TOP_RELEVANT = 3           # Google's top results for "climbing gym" usually are climbing gyms

_cache: dict[tuple, tuple[float, list[dict]]] = {}
_by_id: dict[str, dict] = {}  # place_id -> last seen result (for resolving a chosen gym)


def api_key() -> str | None:
    return os.environ.get("GOOGLE_MAPS_API_KEY") or None


def is_climbing(name: str) -> bool:
    """Google has no climbing type, so judge by name."""
    n = name.lower()
    return any(w in n for w in CLIMBING_WORDS)


def _post(url: str, body: dict, fields: str) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": api_key(), "X-Goog-FieldMask": fields})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def _place(p: dict) -> dict:
    loc = p.get("location") or {}
    out = {"place_id": p["id"], "name": (p.get("displayName") or {}).get("text", ""),
           "lat": loc.get("latitude"), "lng": loc.get("longitude"),
           "types": p.get("types", []), "address": p.get("formattedAddress")}
    out["climbing"] = is_climbing(out["name"])
    _by_id[out["place_id"]] = out
    return out


def search(query: str, lat: float | None = None, lng: float | None = None) -> list[dict]:
    """Text Search, biased to (lat, lng) when given. [] without a key or on error."""
    if not api_key() or not query.strip():
        return []
    key = (query.strip().lower(), round(lat, 3) if lat is not None else None, round(lng, 3) if lng is not None else None)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    body: dict = {"textQuery": query, "pageSize": 10}
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": SEARCH_RADIUS_M}}
    try:
        places = [_place(p) for p in _post(SEARCH_URL, body, FIELDS).get("places", [])]
        for rank, p in enumerate(places):
            p["rank"] = rank  # Google's relevance order for this query
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
        print(f"Google Places search failed: {e}", flush=True)
        return []
    for p in places:
        p["distance_m"] = (haversine_m(lat, lng, p["lat"], p["lng"])
                           if None not in (lat, lng, p["lat"], p["lng"]) else None)
    _cache[key] = (time.time(), places)
    return places


def search_gyms(query: str, lat: float | None = None, lng: float | None = None) -> list[dict]:
    """A climber's typed search, steered to climbing gyms: "mosaic" alone finds a stairway
    and apartments; "mosaic climbing gym" finds Mosaic Boulders (tested 2026-10-21)."""
    q = query.strip()
    if q and "climb" not in q.lower() and "gym" not in q.lower():  # "boulder" alone finds a city
        q = f"{q} climbing gym"
    return search(q, lat, lng)


def nearby_gyms(lat: float, lng: float) -> list[dict]:
    """Gyms near the climber: likely climbing gyms (climbing name, or among Google's top
    results for "climbing gym") first, by distance. The closest likely gym within
    SUGGEST_WITHIN_M is marked suggested — a climbing-named one when there is one."""
    places = [dict(p) for p in search("climbing gym", lat, lng)]
    far = lambda p: p["distance_m"] if p["distance_m"] is not None else 1e12  # noqa: E731
    for p in places:
        p["likely"] = p["climbing"] or p["rank"] < TOP_RELEVANT
        p["suggested"] = False
    places.sort(key=lambda p: (not p["likely"], far(p)))
    near = [p for p in places if p["likely"] and far(p) <= SUGGEST_WITHIN_M]
    if near:
        min(near, key=lambda p: (not p["climbing"], far(p)))["suggested"] = True
    return places


def details(place_id: str) -> dict | None:
    """A gym by place id: from the in-memory results, else a Place Details call."""
    if place_id in _by_id:
        return _by_id[place_id]
    if not api_key():
        return None
    req = urllib.request.Request(DETAILS_URL.format(place_id), headers={
        "X-Goog-Api-Key": api_key(), "X-Goog-FieldMask": DETAIL_FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return _place(json.load(r))
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as e:
        print(f"Google Places details failed: {e}", flush=True)
        return None
