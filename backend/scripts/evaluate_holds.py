"""M9 evaluation — mask AP50 + mean IoU on held-out gyms, with a visualization.

Run from the parent "rock climbing" folder:
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/evaluate_holds.py
"""

from __future__ import annotations

import argparse
import os
import sys

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import cv2
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.holds import HoldDataset, build_model, load_via_index  # noqa: E402

DATA = os.path.join(ROOT, "data")
ARTIFACTS = os.path.join(BACKEND, "artifacts")


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


def ap50(all_scores, all_tp, n_gt) -> float:
    """AP at IoU 0.5 from score-sorted TP/FP flags (VOC-style integral)."""
    if n_gt == 0 or not all_scores:
        return 0.0
    order = np.argsort(-np.array(all_scores))
    tp = np.array(all_tp)[order]
    fp = 1 - tp
    tp_cum, fp_cum = np.cumsum(tp), np.cumsum(fp)
    recall = tp_cum / n_gt
    precision = tp_cum / np.maximum(tp_cum + fp_cum, 1e-9)
    # monotonic precision envelope
    mrec = np.concatenate([[0], recall, [1]])
    mpre = np.concatenate([[0], precision, [0]])
    for i in range(len(mpre) - 1, 0, -1):
        mpre[i - 1] = max(mpre[i - 1], mpre[i])
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ARTIFACTS, "m9_maskrcnn.pt"))
    ap.add_argument("--gyms", nargs="+", default=["sm", "bh-phone"])
    ap.add_argument("--score", type=float, default=0.5, help="score thresh for mean-IoU + viz")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    device = torch.device(
        "mps" if (args.device == "auto" and torch.backends.mps.is_available())
        else ("cpu" if args.device == "auto" else args.device)
    )
    model = build_model().to(device)
    state = torch.load(args.ckpt, map_location=device)
    model.load_state_dict(state["model"])
    model.eval()

    ds = HoldDataset(load_via_index(DATA, args.gyms), train=False)
    print(f"eval images: {len(ds)} from {args.gyms}")

    scores_all, tp_all, n_gt = [], [], 0
    ious_matched = []
    first_viz = True

    for idx in range(len(ds)):
        image, target = ds[idx]
        gt_masks = target["masks"].numpy().astype(bool)
        n_gt += len(gt_masks)
        with torch.no_grad():
            out = model([image.to(device)])[0]
        pr_masks = (out["masks"].squeeze(1).cpu().numpy() > 0.5)
        pr_scores = out["scores"].cpu().numpy()

        matched = set()
        for s, pm in sorted(zip(pr_scores, pr_masks), key=lambda t: -t[0]):
            best_iou, best_j = 0.0, -1
            for j, gm in enumerate(gt_masks):
                if j in matched:
                    continue
                iou = mask_iou(pm, gm)
                if iou > best_iou:
                    best_iou, best_j = iou, j
            is_tp = best_iou >= 0.5 and best_j >= 0
            scores_all.append(float(s))
            tp_all.append(1 if is_tp else 0)
            if is_tp:
                matched.add(best_j)
                ious_matched.append(best_iou)

        if first_viz:
            first_viz = False
            rgb = (image.numpy().transpose(1, 2, 0) * 255).astype(np.uint8).copy()
            for pm, s in zip(pr_masks, pr_scores):
                if s < args.score:
                    continue
                cnts, _ = cv2.findContours(pm.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(rgb, cnts, -1, (0, 255, 0), 2)
            os.makedirs(ARTIFACTS, exist_ok=True)
            cv2.imwrite(os.path.join(ARTIFACTS, "m9_eval_sample.png"), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))

    ap_50 = ap50(scores_all, tp_all, n_gt)
    mean_iou = float(np.mean(ious_matched)) if ious_matched else 0.0
    preds_kept = sum(1 for s in scores_all if s >= args.score)
    print(f"\nGT instances: {n_gt} | predictions: {len(scores_all)}")
    print(f"mask AP50: {ap_50 * 100:.1f}")
    print(f"mean IoU (matched): {mean_iou:.3f}")
    print(f"viz saved: {os.path.join(ARTIFACTS, 'm9_eval_sample.png')} "
          f"({preds_kept} preds >= {args.score})")
    print("\nM9 eval:", "PASS" if ap_50 >= 0.20 else "WEAK (needs more training/tuning)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
