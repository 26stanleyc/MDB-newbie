# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Capitan** — climbing-gym app: photograph a wall → detect holds → group them into routes by color → per-hold depth/graspability → wall geometry → personalized, balance-aware hand/foot beta. Two halves:

- **`rc/`** — Expo / React Native iOS app (Phase 1, built against a mock API). It is a **separate nested git repo** with its own `rc/CLAUDE.md` + `rc/AGENTS.md` — follow those when working there. Note: `rc/CLAUDE.md` still says "do not begin Phase 2"; that gate was crossed on 2026-10-04 at Stanley's instruction.
- **`backend/`** — Python ML pipeline (Phase 2), milestones M7–M12. Lives in this parent repo next to the data and models.

**Read `PROGRESS.md` before backend work.** It is the running log of every milestone: what was built, validation numbers, decisions, and a "What was tried that didn't work" section. Append to it (status table + milestone section + changelog) when finishing meaningful work. **`IMPROVEMENT_PLAN.md`** is the roadmap (phases, targets, data sources, keys needed). Design authority is `rc/Capitan — Design Document v2.md` (Draft v4).

Note: `bh-phone` VIA polygons are at half resolution; `load_via_index` rescales them via `ANNOTATION_SCALE`. Any new annotation parser must do the same.

## Commands

Everything runs **from this parent folder** with the venv at `./.venv` (Python 3.12). Scripts add `backend/` to `sys.path` themselves and use paths relative to the parent.

```bash
./.venv/bin/python backend/scripts/evaluate_quality.py          # M7 validation
./.venv/bin/python backend/scripts/evaluate_places.py           # M8 (12 behavioral checks)
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --epochs 60   # M9 (~25 min MPS)
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/evaluate_holds.py            # M9 AP50 / IoU
./.venv/bin/python backend/scripts/evaluate_routes.py           # M10 color purity
./.venv/bin/python backend/scripts/validate_depth_synthetic.py  # M11 geometry (14 synthetic checks)
./.venv/bin/python backend/scripts/build_grasp.py --stems 0075 0917
./.venv/bin/python backend/scripts/plan_beta.py --stem 0075     # M12 beta planner
```

Backend server (the app talks to this; it also needs `npx expo start` in `rc/`):

```bash
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/uvicorn --app-dir backend server.app:app --host 0.0.0.0 --port 8000
```

There is no unit-test suite — each milestone's `scripts/evaluate_*.py` / `validate_*.py` is its verification; run the relevant one before calling backend work done. Usage for every script is in its module docstring.

`backend/requirements.txt` only lists numpy + opencv; the venv actually also has torch/torchvision, scikit-learn, transformers, diffusers, trimesh, matplotlib. Add deps there when you rely on them.

Frontend (inside `rc/`): `npx expo start`, `npx tsc --noEmit`, `npx expo lint`, `npx expo start --web` for browser debugging.

## Backend architecture

`backend/pipeline/` = library modules; `backend/scripts/` = CLI entry points that build/evaluate/visualize; outputs go to `backend/artifacts/`.

`backend/server/app.py` (FastAPI) implements the app's `CapitanApi` contract (`rc/src/api/types.ts`) over HTTP; `rc/src/api/http.ts` is the client, selected by `API_MODE` (`rc/src/config/api.ts`, default `http`; `EXPO_PUBLIC_API_MODE=mock` for the in-app mock). The server runs `pipeline/scan.py` (detect → color routes; beta per request) in a single worker thread and saves every upload plus every correction under `backend/store/` (gitignored) — that folder is the training corpus. Scans keep internal fields (`geom`, `imageSize`, `captureMeta`, `pathOverrides`) that are stripped from API responses. Auth/profile stay on the client mock.

Per-scan flow: `quality.py` (M7: blur/exposure/is-a-wall) → `holds.py` (M9: torchvision Mask R-CNN, classes bg/hold/volume, checkpoint `artifacts/m9_maskrcnn.pt`) → `routes.py` (M10: CIELAB per-hold color, cluster-then-name) → depth → `beta.py` (M12). `places.py` (M8) is gym dedup/search, pure stdlib.

Depth/geometry has several parallel pipelines, kept side by side for comparison:
- `depth.py` + `depth_schema.py` + `depth_model.py` — M11 full-image DA3 metric depth → per-hold records. DA3 runs on **Colab GPU** only (`backend/colab/`); depth maps are cached in `artifacts/da3_depth/*.npz`.
- `hold_relief.py` → `grasp.py` — Depth Anything V2 Small on per-hold full-res crops (MPS) → relative relief → grasp heatmap/point.
- `fused_depth.py` — anchors DA V2 relief to DA3 metric, protrusion along local wall normal.
- `wall_normals.py` — Marigold normals → wall-panel angles (single photo).
- `geom3d.py` — back-projects holds to 3D for the beta planner.
- `backend/multiview/` — DUSt3R multi-view reconstruction (vendored `dust3r/` repo, `run_dust3r.py`, `analyze_folds.py`, `compare_geometry.py`). OOMs on this Mac → run via `dust3r_colab.ipynb`.

Key known limits (details in PROGRESS.md): dataset images have no EXIF/gravity, so absolute metric scale is assumed (`scripts/scale_from_holds.py` anchors it via average hold size); full-image DA3 can't resolve hold protrusion; single-view normals miss subtle folds.

## Data

- `data/{bh,bh-phone,sm}/` — gym photos with VIA polygon annotations (`data/*-annotation.{csv,json}`, holds + volumes, some `route_id`s). Only **19 images are densely labeled** (bh 15, sm 2, bh-phone 2). Splits: train/val = `bh`; cross-gym test = `sm` + `bh-phone`. `bh` (1,061 images) is a gym walk-around, so many walls have multiple views.
- `data/model/` — pre-trained Detectron2 hold model + triplet network (unused; M9 replaced Detectron2).
- `data.py` downloads the same dataset from Kaggle via `kagglehub`.

## Legacy / scratch at the root

`std/` + `run_standard_demo.py` + `demo.ipynb` + `visualize.py` + `out_*.png` are the original classical-CV prototype (blob + Canny contour hold detection). Not part of the pipeline; don't build on it. `progress_img/` holds downscaled images embedded in PROGRESS.md.

## Git

Only a handful of files are tracked in the parent repo (most of `backend/`, `data/`, artifacts and `rc/` are untracked). Large binaries live in-tree (`m9_maskrcnn.pt` 176 MB, `.npz`, `.ply`, zips) — don't `git add` broadly; stage specific files.
