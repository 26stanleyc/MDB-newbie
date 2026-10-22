"""M8 — place matching.

Dedupes gyms so "Mission Cliffs" and "mission cliffs SF" resolve to one place
(design doc §10 M8). Two signals:
  - coordinates: if two places are within SAME_PLACE_M of each other, same gym.
  - fuzzy name: normalized token-set + sequence similarity catches casing,
    qualifiers ("SF"), and typos.

Decision: coords dominate when both have them; otherwise fall back to name
similarity (gated by a looser distance when coords exist, so two same-named
gyms in different cities stay separate). Pure stdlib — no GPU, no deps.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

SAME_PLACE_M = 150.0        # within this distance → certainly the same gym
NAME_MATCH_MAX_M = 3000.0   # name match only counts if coords are within this
NAME_THRESHOLD = 0.80       # similarity at/above this is a name match

# Dropped during normalization: casing/qualifier noise, not identity.
_STOPWORDS = {
    "the", "a", "climbing", "gym", "fitness", "co", "inc", "llc",
    "and", "sf", "nyc", "la", "bay", "ca",
}


def normalize_name(name: str) -> str:
    tokens = re.sub(r"[^a-z0-9]+", " ", name.lower()).split()
    kept = [t for t in tokens if t not in _STOPWORDS]
    return " ".join(kept or tokens)  # if everything was a stopword, keep original tokens


def name_similarity(a: str, b: str) -> float:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    ta, tb = set(na.split()), set(nb.split())
    jaccard = len(ta & tb) / len(ta | tb)
    seq = SequenceMatcher(None, na.replace(" ", ""), nb.replace(" ", "")).ratio()
    return max(jaccard, seq)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


@dataclass
class Place:
    id: str
    name: str
    lat: float | None = None
    lng: float | None = None
    scan_count: int = 0
    google_place_id: str | None = None  # set when the gym came from Google Places


@dataclass
class PlaceRegistry:
    """Backend-side registry implementing getNearbyPlaces / searchPlaces /
    createPlace with dedup (§7 functions)."""

    places: list[Place] = field(default_factory=list)
    _next: int = 1

    def _match(self, name: str, lat: float | None, lng: float | None) -> Place | None:
        best: tuple[float, Place] | None = None
        for p in self.places:
            has_coords = lat is not None and lng is not None and p.lat is not None and p.lng is not None
            dist = haversine_m(lat, lng, p.lat, p.lng) if has_coords else None  # type: ignore[arg-type]

            if dist is not None and dist <= SAME_PLACE_M:
                return p  # coincident coordinates → same gym

            sim = name_similarity(name, p.name)
            if sim >= NAME_THRESHOLD and (dist is None or dist <= NAME_MATCH_MAX_M):
                if best is None or sim > best[0]:
                    best = (sim, p)
        return best[1] if best else None

    def create_place(self, name: str, lat: float | None = None, lng: float | None = None) -> Place:
        """Return an existing matching place, or create a new one (dedup)."""
        existing = self._match(name, lat, lng)
        if existing:
            if existing.lat is None and lat is not None:  # backfill coords
                existing.lat, existing.lng = lat, lng
            return existing
        place = Place(id=f"place-{self._next}", name=name.strip(), lat=lat, lng=lng)
        self._next += 1
        self.places.append(place)
        return place

    def get_nearby(self, lat: float, lng: float) -> list[Place]:
        withd = [
            (haversine_m(lat, lng, p.lat, p.lng), p)
            for p in self.places
            if p.lat is not None and p.lng is not None
        ]
        withd.sort(key=lambda t: t[0])
        return [p for _, p in withd]

    def search(self, query: str) -> list[Place]:
        q = query.strip()
        if not q:
            return []
        scored = [(name_similarity(q, p.name), p) for p in self.places]
        nq = normalize_name(q)
        # keep fuzzy matches OR simple substring hits
        hits = [
            (s, p) for s, p in scored
            if s >= 0.5 or nq and nq in normalize_name(p.name)
        ]
        hits.sort(key=lambda t: t[0], reverse=True)
        return [p for _, p in hits]
