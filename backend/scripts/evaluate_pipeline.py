"""End-to-end pipeline evaluation: detection → route colors → path planner.

Scores every stage on the held-out split (pipeline/splits.py) with the same code the
server runs (pipeline/scan.py), and writes a metrics JSON so runs can be compared as
data is added. Stages:

  detection   mask AP50, AP@[.5:.95], precision/recall at the app's score cutoff,
              matched IoU, small-hold recall — per gym and overall.
  colors      on hand-labeled holds (isolates the color stage): hold / route color
              accuracy vs backend/eval/route_colors.json, which can't be gamed by
              merging everything into one color (unlike purity/completeness).
  planner     on hand-labeled routes (no ground-truth beta exists yet, so these are
              sanity metrics): reaches the top hold, stance stability, feet placed,
              and personalization (taller climber never needs more moves).
  end-to-end  on detected holds: route holds found, their colors right; for each
              labeled route, the best-matching predicted route's hold IoU; "recovered"
              = IoU >= 0.5 with the right color; planner on recovered routes.

Run from the parent "rock climbing" folder:
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/evaluate_pipeline.py
    ... --split train            # sanity check on training images
    ... --ckpt path/to/model.pt  # another checkpoint (default: the train-split model,
                                 # never the app's all-data model — it has seen the test set)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import cv2
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.beta import Hold as BetaHold, plan_beta  # noqa: E402
from pipeline.holds import build_model, load_via_index  # noqa: E402
from pipeline.routes import ColorNamer  # noqa: E402
from pipeline.scan import (  # noqa: E402
    MAX_DETECTIONS, SCORE_MIN, build_scan, detection_from_mask, meters_per_pixel, working_image,
)
from pipeline.splits import all_gyms, split_of  # noqa: E402

DATA = os.path.join(ROOT, "data")
EVAL = os.path.join(BACKEND, "eval")
CLIMBERS = [(155, 155), (170, 172), (185, 190)]  # (height, wingspan) cm
SMALL_AREA = 32 * 32  # px at working resolution (COCO "small")


# --- detection matching --------------------------------------------------------

def _boxes(masks: np.ndarray) -> np.ndarray:
    out = np.zeros((len(masks), 4), int)
    for i, m in enumerate(masks):
        ys, xs = np.nonzero(m)
        out[i] = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else (0, 0, 0, 0)
    return out


def iou_matrix(pred: np.ndarray, gt: np.ndarray) -> np.ndarray:
    """Mask IoU for every (pred, gt) pair, computed only where boxes overlap."""
    ious = np.zeros((len(pred), len(gt)), np.float32)
    if not len(pred) or not len(gt):
        return ious
    pb, gb = _boxes(pred), _boxes(gt)
    p_area, g_area = pred.reshape(len(pred), -1).sum(1), gt.reshape(len(gt), -1).sum(1)
    for i, (x0, y0, x1, y1) in enumerate(pb):
        for j, (a0, b0, a1, b1) in enumerate(gb):
            ix0, iy0, ix1, iy1 = max(x0, a0), max(y0, b0), min(x1, a1), min(y1, b1)
            if ix0 >= ix1 or iy0 >= iy1:
                continue
            inter = np.logical_and(pred[i, iy0:iy1, ix0:ix1], gt[j, iy0:iy1, ix0:ix1]).sum()
            ious[i, j] = inter / (p_area[i] + g_area[j] - inter)
    return ious


def greedy_match(ious: np.ndarray, scores: np.ndarray, thr: float) -> list[int]:
    """For each prediction (any order), the matched gt index or -1, greedy by score."""
    match = [-1] * len(scores)
    taken = set()
    for i in np.argsort(-scores):
        cand = [(ious[i, j], j) for j in range(ious.shape[1]) if j not in taken and ious[i, j] >= thr]
        if cand:
            _, j = max(cand)
            match[i] = j
            taken.add(j)
    return match


def average_precision(scores: list[float], tps: list[int], n_gt: int) -> float:
    if n_gt == 0 or not scores:
        return 0.0
    order = np.argsort(-np.array(scores))
    tp = np.array(tps)[order]
    tp_cum, fp_cum = np.cumsum(tp), np.cumsum(1 - tp)
    recall = tp_cum / n_gt
    precision = tp_cum / np.maximum(tp_cum + fp_cum, 1e-9)
    mrec = np.concatenate([[0], recall, [1]])
    mpre = np.concatenate([[0], precision, [0]])
    for i in range(len(mpre) - 1, 0, -1):
        mpre[i - 1] = max(mpre[i - 1], mpre[i])
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


class DetAccumulator:
    THRESHOLDS = np.arange(0.5, 0.96, 0.05)

    def __init__(self):
        self.scores: list[float] = []
        self.tps = {t: [] for t in self.THRESHOLDS}
        self.n_gt = self.n_small = 0
        self.kept_tp = self.kept_pred = self.small_found = 0
        self.matched_ious: list[float] = []

    def add(self, ious, scores, gt_areas):
        self.n_gt += len(gt_areas)
        self.n_small += int((gt_areas < SMALL_AREA).sum())
        self.scores += scores.tolist()
        for t in self.THRESHOLDS:
            self.tps[t] += [int(m >= 0) for m in greedy_match(ious, scores, t)]
        keep = scores >= SCORE_MIN
        m50 = greedy_match(ious[keep], scores[keep], 0.5)
        self.kept_pred += int(keep.sum())
        self.kept_tp += sum(m >= 0 for m in m50)
        self.small_found += sum(1 for m in m50 if m >= 0 and gt_areas[m] < SMALL_AREA)
        kept_ious = ious[keep]
        self.matched_ious += [float(kept_ious[i, m]) for i, m in enumerate(m50) if m >= 0]

    def result(self) -> dict:
        aps = {t: average_precision(self.scores, self.tps[t], self.n_gt) for t in self.THRESHOLDS}
        return {
            "images_gt_holds": self.n_gt,
            "mask_AP50": round(100 * aps[self.THRESHOLDS[0]], 1),
            "mask_AP": round(100 * float(np.mean(list(aps.values()))), 1),
            "precision@cutoff": round(self.kept_tp / max(1, self.kept_pred), 3),
            "recall@cutoff": round(self.kept_tp / max(1, self.n_gt), 3),
            "small_recall@cutoff": round(self.small_found / max(1, self.n_small), 3),
            "matched_IoU": round(float(np.mean(self.matched_ious)) if self.matched_ious else 0.0, 3),
        }


# --- planner -------------------------------------------------------------------

def plan_metrics(route_ids: list[str], geom: dict, image_size: list[int]) -> dict | None:
    """Sanity metrics for the planner on one route across several climbers."""
    if len(route_ids) < 3:
        return None
    W, H = image_size
    mpp = meters_per_pixel(geom, image_size)
    holds = [BetaHold(h, np.array([geom[h]["center"]["x"] * W * mpp, (1 - geom[h]["center"]["y"]) * H * mpp]))
             for h in route_ids]
    top = max(holds, key=lambda h: h.pos[1]).id
    out = {"reached_top": [], "moves": [], "stability": [], "feet_per_hand": []}
    for height, span in CLIMBERS:
        steps, stab = plan_beta(holds, height, span)
        hands = [s for s in steps if s.limb in ("LH", "RH")]
        feet = [s for s in steps if s.limb in ("LF", "RF")]
        out["reached_top"].append(hands[-1].hold_id == top)
        out["moves"].append(len(hands) - 1)  # first two hand steps share the start hold
        out["stability"].append(float(np.mean(stab)))
        out["feet_per_hand"].append(len(feet) / max(1, len(hands)))
    return out


def summarize_plans(plans: list[dict]) -> dict:
    if not plans:
        return {}
    reached = [r for p in plans for r in p["reached_top"]]
    monotone = [all(a >= b for a, b in zip(p["moves"], p["moves"][1:])) for p in plans]
    return {
        "routes": len(plans),
        "reached_top": round(float(np.mean(reached)), 3),
        "taller_never_more_moves": round(float(np.mean(monotone)), 3),
        "mean_moves_by_height": {str(h): round(float(np.mean([p["moves"][i] for p in plans])), 2)
                                 for i, (h, _) in enumerate(CLIMBERS)},
        "mean_stability": round(float(np.mean([s for p in plans for s in p["stability"]])), 3),
        "feet_per_hand_move": round(float(np.mean([f for p in plans for f in p["feet_per_hand"]])), 3),
    }


# --- main ------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    # The app's model (m9_maskrcnn.pt) is trained on ALL data, test images included —
    # evaluate the train-split model instead (train_holds.py --split train).
    ap.add_argument("--ckpt", default=os.path.join(BACKEND, "artifacts", "m9_train_split.pt"))
    ap.add_argument("--split", default="test", choices=["test", "train", "all"])
    ap.add_argument("--out", default=None, help="metrics JSON (default backend/eval/metrics_<split>.json)")
    ap.add_argument("--label", default="", help="free-text name for this run")
    ap.add_argument("--palette-colors", action="store_true", help="old palette color rule (baseline)")
    args = ap.parse_args()

    colors_gt = json.load(open(os.path.join(EVAL, "route_colors.json")))
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model = build_model()
    model.load_state_dict(torch.load(args.ckpt, map_location="cpu")["model"])
    model.roi_heads.detections_per_img = MAX_DETECTIONS
    model.roi_heads.score_thresh = 0.05  # low, so AP sees the full precision/recall curve
    model.to(device).eval()

    everything = load_via_index(DATA, all_gyms(DATA))
    samples = [s for s in everything if args.split == "all" or split_of(s.gym, s.path) == args.split]
    # Color references from TRAINING images only, so test colors are never seen.
    namer = False if args.palette_colors else ColorNamer.from_samples(
        [s for s in everything if split_of(s.gym, s.path) == "train"], working_image)
    print(f"{len(samples)} images in split '{args.split}': "
          + ", ".join(f"{g}={n}" for g, n in Counter(s.gym for s in samples).items()))

    det_all, det_by_gym = DetAccumulator(), defaultdict(DetAccumulator)
    color = Counter()
    plans_gt, plans_e2e, e2e_ious = [], [], []
    e2e = Counter()

    for s in samples:
        key = f"{s.gym}/{os.path.basename(s.path)}"
        bgr = cv2.imread(s.path)
        img = working_image(bgr)
        H, W = img.shape[:2]
        scale = W / bgr.shape[1]

        gt_masks = np.zeros((len(s.instances), H, W), bool)
        for i, inst in enumerate(s.instances):
            m = np.zeros((H, W), np.uint8)
            cv2.fillPoly(m, [np.round(inst.points * scale).astype(np.int32)], 1)
            gt_masks[i] = m.astype(bool)
        gt_areas = gt_masks.reshape(len(gt_masks), -1).sum(1)

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        with torch.no_grad():
            out = model([torch.as_tensor(rgb.transpose(2, 0, 1), dtype=torch.float32).div(255).to(device)])[0]
        p_masks = out["masks"].squeeze(1).cpu().numpy() > 0.5
        p_scores = out["scores"].cpu().numpy()
        p_labels = out["labels"].cpu().numpy()
        ious = iou_matrix(p_masks, gt_masks)
        det_all.add(ious, p_scores, gt_areas)
        det_by_gym[s.gym].add(ious, p_scores, gt_areas)

        routes_gt = colors_gt.get(key)
        if not routes_gt:
            continue
        routed = [i for i, inst in enumerate(s.instances) if inst.route_id in routes_gt]

        # Colors + planner on hand-labeled holds (isolates those stages from detection).
        gt_dets = [detection_from_mask(gt_masks[i], 1.0, "volume" if s.instances[i].label == 2 else "hold")
                   for i in range(len(s.instances))]
        idx = [i for i, d in enumerate(gt_dets) if d]
        scan_gt = build_scan(img, [gt_dets[i] for i in idx], "gt", namer)
        name_of = {idx[k]: h["color"] for k, h in enumerate(scan_gt["holds"])}
        gt_hid = {idx[k]: h["id"] for k, h in enumerate(scan_gt["holds"])}
        by_route = defaultdict(list)
        for i in routed:
            if i in name_of:
                by_route[s.instances[i].route_id].append(i)
        for rid, members in by_route.items():
            ok = routes_gt[rid]
            color["holds"] += len(members)
            color["holds_correct"] += sum(name_of[i] in ok for i in members)
            majority = Counter(name_of[i] for i in members).most_common(1)[0][0]
            color["routes"] += 1
            color["routes_correct"] += majority in ok
            pm = plan_metrics([gt_hid[i] for i in members], scan_gt["geom"], scan_gt["imageSize"])
            if pm:
                plans_gt.append(pm)

        # End-to-end on detected holds, exactly as the server does it.
        keep = np.where(p_scores >= SCORE_MIN)[0]
        dets, det_gt = [], []
        match = greedy_match(ious[keep], p_scores[keep], 0.5)
        for k, i in enumerate(keep):
            d = detection_from_mask(p_masks[i], float(p_scores[i]), "volume" if p_labels[i] == 2 else "hold")
            if d:
                dets.append(d)
                det_gt.append(match[k])
        scan = build_scan(img, dets, "p", namer)
        pred_color = {g: scan["holds"][k]["color"] for k, g in enumerate(det_gt) if g >= 0}
        k_of = {h["id"]: k for k, h in enumerate(scan["holds"])}
        for rid, members in by_route.items():
            ok = routes_gt[rid]
            found = [i for i in members if i in pred_color]
            e2e["route_holds"] += len(members)
            e2e["route_holds_found"] += len(found)
            e2e["route_holds_found_color_ok"] += sum(pred_color[i] in ok for i in found)
            e2e["routes"] += 1
            # Best-matching predicted route by hold IoU (what the climber would tap).
            G = set(members)
            best, best_iou = None, 0.0
            for r in scan["routes"]:
                P = [det_gt[k_of[h]] for h in r["holdIds"]]
                inter = sum(1 for g in P if g in G)
                iou = inter / (len(P) + len(G) - inter)
                if iou > best_iou:
                    best, best_iou = r, iou
            e2e_ious.append(best_iou)
            if best is not None and best_iou >= 0.5 and best["color"] in ok:
                e2e["routes_recovered"] += 1
                pm = plan_metrics(best["holdIds"], scan["geom"], scan["imageSize"])
                if pm:
                    plans_e2e.append(pm)

    metrics = {
        "run": args.label, "date": datetime.now().isoformat(timespec="seconds"),
        "ckpt": os.path.relpath(args.ckpt, ROOT), "split": args.split,
        "images": len(samples),
        "detection": {"overall": det_all.result(), **{g: a.result() for g, a in sorted(det_by_gym.items())}},
        "colors_on_labeled_holds": {
            "routes": color["routes"],
            "hold_color_accuracy": round(color["holds_correct"] / max(1, color["holds"]), 3),
            "route_color_accuracy": round(color["routes_correct"] / max(1, color["routes"]), 3),
        },
        "planner_on_labeled_routes": summarize_plans(plans_gt),
        "end_to_end": {
            "routes": e2e["routes"],
            "route_holds_found": round(e2e["route_holds_found"] / max(1, e2e["route_holds"]), 3),
            "found_holds_color_ok": round(e2e["route_holds_found_color_ok"] / max(1, e2e["route_holds_found"]), 3),
            "mean_route_IoU": round(float(np.mean(e2e_ious)) if e2e_ious else 0.0, 3),
            "routes_recovered": round(e2e["routes_recovered"] / max(1, e2e["routes"]), 3),
            "planner_on_recovered_routes": summarize_plans(plans_e2e),
        },
    }
    out = args.out or os.path.join(EVAL, f"metrics_{args.split}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(metrics, f, indent=2)
    print(json.dumps(metrics, indent=2))
    print(f"\nwritten: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
