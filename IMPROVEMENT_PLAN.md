# Capitan — Improvement Plan

Written 2026-10-20 from an honest audit of what works. Progress on each item goes in
`PROGRESS.md`; this file is the roadmap.

## Where things stand

> **Update 2026-10-20 — measured end to end** (`backend/scripts/evaluate_pipeline.py`,
> numbers in `backend/eval/metrics_test.json`, before/after in PROGRESS.md). Detection is
> good on unseen gyms (AP50 81–98); **route colors are now the weakest stage** (0.53 of
> found holds named right on unseen walls) and limit end-to-end route recovery (0.17).
> More labeled routes (add colors to `backend/eval/route_colors.json`) improve colors
> directly with no retuning. The planner still has no ground truth (Phase 0a).

- **The app runs on a mock API.** Every scan result, route, and path in the app is a
  fixture. The real pipeline is offline scripts in `backend/`; nothing is wired up.
- **Hold detection is better than we thought.** The old "mask AP50 29.4" was an
  evaluation bug: `bh-phone` polygons were drawn on half-size images, so every
  prediction on that gym scored zero. Fixed in `load_via_index` (2026-10-20). Real numbers
  on the held-out gyms (4 images, 201 holds — a small test set, so treat as ±10):

  | Model | mask AP50 | mean IoU |
  |---|---|---|
  | Our Mask R-CNN (`artifacts/m9_maskrcnn.pt`) | **84.0** | 0.884 |
  | Pre-trained Detectron2 (`data/model/model_final.pth`, converted) | **85.9** | 0.860 |

- **The path planner has never been measured.** No ground-truth beta exists. It has
  run on one route; the only evidence is that a tall climber gets fewer moves.
- **Metric scale is assumed** on every image so far (dataset photos have no EXIF/gravity).

Principles: **measure before improving** (a stage without a metric can't be improved);
**fix upstream first** (errors compound: detection → routes → planner); **the app's
correction screens are the labeling tool** once the real backend is wired in.

## Phase 0 — Measurement + wiring (prerequisite)

**0a. Ground-truth benchmark.** 25–30 routes across 3+ gyms, shot with the real app
(so photos carry EXIF focal + gravity). Per route:
- all holds + route membership (Label Studio, pre-filled by the detector);
- the beta — ordered limb→hold sequence — from 2–3 climbers of different heights
  (record via the app's path-correction flow);
- one tape-measured length (wall height or bolt-hole spacing);
- grasp points on ~100 holds.

**0b. End-to-end eval** (`backend/scripts/evaluate_e2e.py`): photo → holds → routes →
beta, scored per stage against 0a, so a bad path can be traced to the stage that broke it.

**0c. Real backend for the app.** ✅ *Local version done 2026-10-20* (`backend/server/app.py`,
`rc/src/api/http.ts`): detection + color routes + beta + places + corrections/grades,
everything saved to `backend/store/`. Remaining: GPU host for DA3/DUSt3R/Marigold,
real auth, deployment beyond the local Wi-Fi.
Original scope: FastAPI service implementing the `CapitanApi` contract
(`rc/src/api/types.ts`); HTTP client in `rc/src/api/` behind `API_MODE`. GPU models
(DA3, DUSt3R, Marigold) on a serverless GPU host (Modal / RunPod) instead of Colab.

## Phase 1 — Hold detection (now: confirm, then harden)

1. **Bigger test set.** 4 test images can't distinguish 84 from 70. Label ~20 more
   held-out images (detector pre-fills, human corrects) before trusting any comparison.
2. **More training data** — 100–150 images across gyms via model-assisted labeling, plus
   public sets (see "Data sources"). Mixed-gym data is what generalizes.
3. **Hard negatives** — crash pads, mats, panel edges labeled as background; size/aspect/
   floor-region filters.
4. **Full-res tiling** — small holds are lost when images are downscaled to 1333 px.
5. **Pick a model** — ours vs converted Detectron2 are tied today; keep ours (trains on
   Mac, no Detectron2 dependency) unless the larger test set says otherwise.

Target: AP50 ≥ 80 on the **enlarged** cross-gym test set, small-hold recall reported separately.

## Phase 2 — Route grouping by color

1. **Color constancy** — per-gym calibration from the color-swatch strip in many photos,
   or chalk/white-hold reference; gray-world fallback. Attacks "similar hues under dim light".
2. **Use the unused triplet network** (`data/model/triplet_network_final.pt`) as a
   hold-appearance embedding.
3. **Spatial prior** — split same-color clusters by position; detect start tape.
4. **Tap-to-pick UX** — user taps a start hold, route is grown from it; corrections are labels.

Target: per-route purity 0.78 → 0.90; % of routes exactly recovered after one tap.

## Phase 3 — Metric scale + wall geometry

1. **Validate on real phone photos** (EXIF + gravity) against the 0a tape measurements.
2. **More scale anchors** — bolt-hole grid (regular dot pattern), per-gym wall height
   entered once; fuse with the hold-size anchor, flag disagreement.
3. **Multi-view in production** — app's "precise" mode already captures 3–5 photos; run
   DUSt3R (and evaluate MASt3R / VGGT) on the GPU host.

Target: distances ±5% vs tape; wall angle ±3° vs inclinometer.

## Phase 4 — Hold depth + graspability

1. Ground truth: calipers / iPhone LiDAR on ~30 holds; grasp points from 0a.
2. Per hold-type handling (volumes = edges, crescents/pinches = two-sided).
3. Replace the grasp heuristic with a small model once ~300 grasp labels exist.

Target: protrusion MAE < 10 mm; grasp point within 3 cm on 75% of holds.

## Phase 5 — Path planner

1. **Run on detected holds**, not GT labels; allow smears/wall feet with a cost.
2. **Body model** — 2D stick figure from height + wingspan (anthropometric ratios)
   instead of fixed reach fractions.
3. **4-limb state search** — one limb moves per step (the Climb-5 / climbing-beta formulation).
4. **Balance** — center of mass over the support polygon; wall angle shifts load to arms.
5. **Pull direction** from the grasp map (underclings need the body above them).
6. **Learn cost weights** from climber-corrected paths (inverse optimization).
7. **Board data for pretraining/eval** — Kilter/Tension climbs (hold positions + grades)
   via BoardLib; useful for grade-consistency checks, though they carry no limb sequences.

Metrics vs 0a: move-match rate, move-count error by height bucket, % paths climbers
rate acceptable. Target: 70% acceptable.

## Phase 6 — Gym identification with Google Maps

Replace manual gym search with automatic lookup from the photo's GPS.

1. **Backend proxy** (key never ships in the app): on capture, the app sends lat/lng →
   backend calls **Places API (New)** Nearby Search (~150 m radius, `gym`-family types)
   plus a Text Search for "climbing gym" biased to the location. There is no
   climbing-specific place type, so rank candidates by distance + name keywords
   (climb, boulder, rock, crag…).
2. **Auto-select** when one candidate is clearly closest and climbing-named; otherwise
   show the top 3 in the existing place picker. Manual search stays as the fallback.
3. **Google `place_id` as the canonical gym key** in `PlaceRegistry` (`pipeline/places.py`)
   — dedup becomes exact; fuzzy name matching remains for user-added places.
4. Restrict the key (Places API only, server IP), cache `place_id`s, and check Google's
   caching terms + current pricing before launch.

Target: correct gym auto-selected for ≥ 90% of in-gym captures.

## Order

```
Phase 0 ──► Phase 1 (confirm) ──► Phase 2 ──► Phase 5
       └──► Phase 3 ──► Phase 4 ───────────┘
Phase 6 is independent — can be done any time after 0c.
```

## Data sources

| Source | What it gives | Notes |
|---|---|---|
| Own app captures | Real photos with EXIF + gravity; corrections as labels | Best long-term source; needs 0c |
| Unlabeled `bh`/`sm` (~2,250 images) | Detection training via model-assisted labeling | Already on disk |
| Roboflow Universe hold sets | Extra segmentation data, other gyms | Needs a free Roboflow account/API key; check each license |
| Kilter / Tension boards (BoardLib) | Thousands of climbs: hold positions + grades | Unofficial API; check terms; no beta sequences |
| Climbers (Phase 0a) | Ground-truth beta, grasp points, tape measurements | Requires people's time |

## Accounts / keys needed (you create them; never paste keys into chat)

| Service | For | When |
|---|---|---|
| Google Maps Platform — Places API (New) | Phase 6 gym detection | Phase 6; needs billing enabled |
| Roboflow | Downloading public hold datasets | Phase 1 |
| Modal or RunPod | GPU inference for the real backend | Phase 0c |
| Kaggle | Already working via `kagglehub` (public dataset) | — |

Keys go in a gitignored `.env` read by the backend.
