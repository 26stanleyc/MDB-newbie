# Capitan backend (Phase 2)

ML pipeline behind the Capitan app (`../rc/`, which still runs on a mock API).
Built milestone by milestone (design doc v4, §10); each one is validated before
the next. **`../PROGRESS.md` is the detailed log** — results, decisions, and what
didn't work.

**Per-scan pipeline:** quality check (M7) → hold detection (M9) → route grouping
by color (M10) → per-hold depth + graspability (M11) → wall geometry → personalized
beta (M12). Place matching is M8.

## Setup

The venv lives at `../.venv` (parent "rock climbing" folder, next to the data).
From the parent folder:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt
```

All scripts are run **from the parent folder**, e.g.
`./.venv/bin/python backend/scripts/evaluate_quality.py`. Usage for each is in its
docstring. Depth Anything 3 and DUSt3R need a GPU and run on Colab
(`colab/`, `multiview/dust3r_colab.ipynb`).

## Milestones

| | Module | Validate with | Result |
|---|---|---|---|
| M7 image quality | `pipeline/quality.py` | `scripts/evaluate_quality.py` | 178/180 real photos pass |
| M8 place matching | `pipeline/places.py` | `scripts/evaluate_places.py` | 12/12 |
| M9 hold detection | `pipeline/holds.py` (Mask R-CNN, MPS) | `scripts/train_holds.py`, `scripts/evaluate_holds.py` | mask AP50 29.4, IoU 0.87 cross-gym |
| M10 route colors | `pipeline/routes.py` | `scripts/evaluate_routes.py` | per-route purity 0.78 |
| M11 hold depth (DA3) | `pipeline/depth.py`, `depth_schema.py`, `depth_model.py` | `scripts/validate_depth_synthetic.py`, `scripts/build_depth_records.py` | 14/14 synthetic; 1,691 real records |
| Grasp / relief | `pipeline/hold_relief.py`, `grasp.py`, `fused_depth.py` | `scripts/build_grasp.py`, `scripts/aggregate_depth_fused.py` | grasp point on 147/148 holds |
| Wall angles | `pipeline/wall_normals.py`, `multiview/` | `scripts/eval_wall_angles.py`, `multiview/analyze_folds.py` | fold angles within a few degrees |
| M12 beta planner | `pipeline/beta.py`, `geom3d.py` | `scripts/plan_beta.py`, `scripts/scale_from_holds.py` | short vs tall climber get different betas |

Outputs land in `artifacts/` (gitignored, along with the model checkpoint).

## Data

`../data/{bh,bh-phone,sm}` — ~2,270 wall photos with VIA polygon annotations
(`*-annotation.{csv,json}`); only 19 are densely labeled. `../data.py` re-downloads
the dataset from Kaggle. `../data/model` — the original pre-trained Detectron2 hold
model + triplet network (not used; M9 replaced it).
