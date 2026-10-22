# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Capitan** — climbing-gym app: photograph a wall → detect holds → group them into routes by color → per-hold depth/graspability → wall geometry → personalized, balance-aware hand/foot beta. Two halves:

- **`rc/`** — Expo / React Native iOS app (Phase 1, built against a mock API). Part of this repo since 2026-10-21 (its earlier history was merged in under `rc/`); it has its own `rc/CLAUDE.md` + `rc/AGENTS.md` — follow those when working there.
- **`backend/`** — Python ML pipeline (Phase 2), milestones M7–M12. Lives in this parent repo next to the data and models.

**Read `PROGRESS.md` before backend work.** It is the running log of every milestone: what was built, validation numbers, decisions, and a "What was tried that didn't work" section. Append to it (status table + milestone section + changelog) when finishing meaningful work. **`IMPROVEMENT_PLAN.md`** is the roadmap (phases, targets, data sources, keys needed). Design authority is `rc/Capitan — Design Document v2.md` (Draft v4).

Note: `bh-phone` VIA polygons are at half resolution; `load_via_index` rescales them via `ANNOTATION_SCALE`. Any new annotation parser must do the same.

## Commands

Everything runs **from this parent folder** with the venv at `./.venv` (Python 3.12). Scripts add `backend/` to `sys.path` themselves and use paths relative to the parent.

```bash
./.venv/bin/python backend/scripts/evaluate_quality.py          # M7 validation
./.venv/bin/python backend/scripts/evaluate_places.py           # M8 (12 behavioral checks)
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/evaluate_holds.py            # M9 AP50 / IoU
./.venv/bin/python backend/scripts/evaluate_routes.py           # M10 color purity
./.venv/bin/python backend/scripts/validate_depth_synthetic.py  # M11 geometry (14 synthetic checks)
./.venv/bin/python backend/scripts/build_grasp.py --stems 0075 0917
./.venv/bin/python backend/scripts/plan_beta.py --stem 0075     # M12 beta planner
./.venv/bin/python backend/scripts/evaluate_pipeline.py          # all stages, held-out split → backend/eval/metrics_test.json
./.venv/bin/python backend/scripts/build_color_refs.py           # rebuild hold-color k-NN refs after labeling routes
./.venv/bin/python backend/scripts/seed_featured.py           # starter walls for Saved walls (server must be running)
./.venv/bin/python backend/scripts/export_feedback.py          # app corrections → data/app/ + data/app-annotation.csv + data/app-hold-colors.json (--dry-run to preview)
./.venv/bin/python backend/scripts/judge_paths.py fit --source both   # planner weights from Claude judgments + app path picks (--save to apply)
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --split train --out backend/artifacts/m9_train_split.pt   # model for evaluation
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --split all    # the app's model (~70 min MPS)
```

Backend server (the app talks to this; it also needs `npx expo start` in `rc/`):

```bash
PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/uvicorn --app-dir backend server.app:app --host 0.0.0.0 --port 8000
```

There is no unit-test suite. **`scripts/evaluate_pipeline.py` is the main check**: it scores detection → colors → planner → end-to-end on the held-out split with the server's own code and writes `backend/eval/metrics_test.json`; compare against the committed numbers before claiming an improvement. Per-milestone `scripts/evaluate_*.py` / `validate_*.py` remain for their stages (`evaluate_routes.py`'s purity/completeness can be maxed by merging all colors — don't optimize it). Usage for every script is in its module docstring.

Evaluation rules (so results stay honest as data grows):
- Splits come from `pipeline/splits.py`: gyms `sm` + `bh-phone` held out entirely, other images hashed 75/25. Never tune on the test split — choose settings by leave-one-image-out on train, then report test once.
- `backend/eval/route_colors.json` is hand-labeled route color ground truth (several names = ambiguous); `backend/eval/hold_colors.json` holds per-hold color labels for gyms without route annotations (currently `data/mosaic/`, which must exist locally). Color naming is k-NN against these labels (`pipeline/routes.py` `ColorNamer`); the evaluator builds its references from train images only.
- Shipping: after evaluating, retrain on everything (`train_holds.py --split all`) and rebuild colors (`build_color_refs.py`).

Frontend (inside `rc/`): `npx expo start`, `npx tsc --noEmit`, `npx expo lint`, `npx expo start --web` for browser debugging.

## Backend architecture

`backend/pipeline/` = library modules; `backend/scripts/` = CLI entry points that build/evaluate/visualize; outputs go to `backend/artifacts/`.

`backend/server/app.py` (FastAPI) implements the app's `CapitanApi` contract (`rc/src/api/types.ts`) over HTTP; `rc/src/api/http.ts` is the client, selected by `API_MODE` (`rc/src/config/api.ts`, default `http`; `EXPO_PUBLIC_API_MODE=mock` for the in-app mock). The server runs `pipeline/scan.py` (detect → color routes; then an analysis phase, `pipeline/analysis.py`: hold quality, grip point, wall angles; beta per request) in a single worker thread and saves every upload plus every correction under `backend/store/` (gitignored) — that folder is the training corpus. Scans keep internal fields (`geom`, `imageSize`, `captureMeta`, `pathOverrides`) that are stripped from API responses. Auth/profile stay on the client mock. Secrets (`ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`) live in the gitignored root `.env`, loaded by `pipeline/env.py`; the Google key is server-side only (`pipeline/google_places.py`, gym finder).

Per-scan flow: `quality.py` (M7: blur/exposure/is-a-wall) → `holds.py` (M9: torchvision Mask R-CNN, classes bg/hold/volume, checkpoint `artifacts/m9_maskrcnn.pt`) → `people.py` (drops holds that are mostly a person, COCO Mask R-CNN) → `routes.py` (M10: CIELAB per-hold color, cluster-then-name) → depth → `beta.py` (M12). `places.py` (M8) is gym dedup/search, pure stdlib.

Depth/geometry has several parallel pipelines, kept side by side for comparison:
- `depth.py` + `depth_schema.py` + `depth_model.py` — M11 full-image DA3 metric depth → per-hold records. DA3 runs on **Colab GPU** only (`backend/colab/`); depth maps are cached in `artifacts/da3_depth/*.npz`.
- `hold_relief.py` → `grasp.py` — Depth Anything V2 Small on per-hold full-res crops (MPS) → relative relief → grasp heatmap/point.
- `fused_depth.py` — anchors DA V2 relief to DA3 metric, protrusion along local wall normal.
- `wall_normals.py` — Marigold normals → wall-panel angles (single photo).
- `geom3d.py` — back-projects holds to 3D for the beta planner.
- `backend/multiview/` — DUSt3R multi-view reconstruction (vendored `dust3r/` repo, `run_dust3r.py`, `analyze_folds.py`, `compare_geometry.py`). OOMs on this Mac → run via `dust3r_colab.ipynb`.

Key known limits (details in PROGRESS.md): dataset images have no EXIF/gravity, so absolute metric scale is assumed (`scripts/scale_from_holds.py` anchors it via average hold size); full-image DA3 can't resolve hold protrusion; single-view normals miss subtle folds.

## Data

- `data/{bh,bh-phone,sm}/` — gym photos with VIA polygon annotations (`data/*-annotation.{csv,json}`, holds + volumes, some `route_id`s). Only **19 images are densely labeled** (bh 15, sm 2, bh-phone 2). Splits: see `pipeline/splits.py` (test = `sm`, `bh-phone`, and ~25% of other gyms' images by hash). `bh` (1,061 images) is a gym walk-around, so many walls have multiple views.
- `data/model/` — pre-trained Detectron2 hold model + triplet network (unused; M9 replaced Detectron2).
- `data.py` downloads the same dataset from Kaggle via `kagglehub`.
- **App feedback:** the server logs every correction under `backend/store/scans/<id>/*.jsonl`; "Holds look right" in the app sets `reviewedAt` (`POST /scans/{id}/review`). `scripts/export_feedback.py` turns reviewed scans into the train-only `app` gym (never in the test split, never scored), which `train_holds.py` includes by default (`--no-app-feedback` to leave out). Unreviewed scans contribute only the colors the climber set. Exporting never retrains.
- **Adding data:** put images in `data/<gym>/` with a VIA export `data/<gym>-annotation.csv` (polygon regions; `hold_type` hold/volume; optional `route_id`). Training, color references and evaluation pick up every `*-annotation.csv` automatically. For color ground truth, add the route colors to `backend/eval/route_colors.json` (key `"<gym>/<file>"`).

## Legacy / scratch at the root

`std/` + `run_standard_demo.py` + `demo.ipynb` + `visualize.py` + `out_*.png` are the original classical-CV prototype (blob + Canny contour hold detection). Not part of the pipeline; don't build on it. `progress_img/` holds downscaled images embedded in PROGRESS.md.

## Git

Only a handful of files are tracked in the parent repo (most of `backend/`, `data/`, artifacts and `rc/` are untracked). Large binaries live in-tree (`m9_maskrcnn.pt` 176 MB, `.npz`, `.ply`, zips) — don't `git add` broadly; stage specific files.
