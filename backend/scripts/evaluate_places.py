"""Validate M8 place matching: variants dedupe, distinct gyms stay separate,
nearby ordering is correct. No real place dataset exists, so these are
behavioral test cases for the matching logic (design doc §10 M8).

Run from the parent "rock climbing" folder:
    ./.venv/bin/python backend/scripts/evaluate_places.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

from pipeline.places import PlaceRegistry, name_similarity  # noqa: E402

CASES: list[tuple[str, bool]] = []


def check(desc: str, cond: bool):
    CASES.append((desc, cond))
    print(f"  [{'ok' if cond else 'XX'}] {desc}")


def main() -> int:
    reg = PlaceRegistry()

    mc = reg.create_place("Mission Cliffs", 37.7701, -122.4120)

    # Same gym, different casing + qualifier, no coords → dedupe by name.
    p2 = reg.create_place("mission cliffs SF")
    check("‘mission cliffs SF’ dedupes to ‘Mission Cliffs’", p2.id == mc.id)

    # Same gym, slightly different coords (~30 m) → dedupe by coordinates.
    p3 = reg.create_place("Mission Cliffs Bouldering", 37.7703, -122.4121)
    check("nearby coords dedupe to same place", p3.id == mc.id)

    # Typo → sequence similarity still matches.
    p4 = reg.create_place("Misson Cliffs", 37.7701, -122.4120)
    check("typo ‘Misson Cliffs’ dedupes", p4.id == mc.id)

    # Different gym nearby → stays separate.
    dp = reg.create_place("Dogpatch Boulders", 37.7576, -122.3880)
    check("‘Dogpatch Boulders’ is a new place", dp.id != mc.id)

    # Same name, different city (coords far apart) → separate places.
    mov_sf = reg.create_place("Movement", 37.7985, -122.4360)
    mov_den = reg.create_place("Movement", 39.7600, -104.9900)
    check("same name, far coords → two places", mov_sf.id != mov_den.id)

    check("registry has exactly 4 distinct places", len(reg.places) == 4)

    # Nearby ordering from a point near Mission Cliffs.
    nearby = reg.get_nearby(37.7701, -122.4120)
    check("nearest place is Mission Cliffs", nearby[0].id == mc.id)
    check("Dogpatch is nearer than Movement-SF",
          nearby.index(next(p for p in nearby if p.id == dp.id))
          < nearby.index(next(p for p in nearby if p.id == mov_sf.id)))

    # Search.
    res = reg.search("mission")
    check("search ‘mission’ finds Mission Cliffs", bool(res) and res[0].id == mc.id)
    check("search ‘dogpatch’ finds Dogpatch", bool(reg.search("dogpatch")) and reg.search("dogpatch")[0].id == dp.id)

    # Similarity sanity.
    check("similarity('Mission Cliffs','mission cliffs SF') high",
          name_similarity("Mission Cliffs", "mission cliffs SF") >= 0.9)
    check("similarity('Mission Cliffs','Dogpatch Boulders') low",
          name_similarity("Mission Cliffs", "Dogpatch Boulders") < 0.3)

    passed = sum(1 for _, c in CASES if c)
    print(f"\nM8 validation: {passed}/{len(CASES)} ->", "PASS" if passed == len(CASES) else "FAIL")
    return 0 if passed == len(CASES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
