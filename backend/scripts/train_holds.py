"""M9 training — fine-tune Mask R-CNN on the hold/volume annotations (Mac/MPS).

Run from the parent "rock climbing" folder:
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --out backend/artifacts/m9_train_split.pt
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --split all   # final model for the app

Few labeled images, many instances each; training takes random crops at the app's
working scale (see HoldDataset). Uses every gym in data/ via pipeline/splits.py, so
new labeled images are picked up automatically; --split train leaves the test images
out so evaluate_pipeline.py stays honest.

Scans climbers confirmed in the app ("Holds look right" — the "app" gym, written by
scripts/export_feedback.py) are included like any other gym; --no-app-feedback leaves
them out (e.g. to compare against a model trained on hand labels only).
"""

from __future__ import annotations

import argparse
import os
import sys

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.holds import HoldDataset, build_model, collate_fn, load_via_index  # noqa: E402
from pipeline.splits import APP_GYM, all_gyms, split_of  # noqa: E402

DATA = os.path.join(ROOT, "data")
ARTIFACTS = os.path.join(BACKEND, "artifacts")


def pick_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=0.005)
    ap.add_argument("--crop", type=int, default=800)
    ap.add_argument("--repeats", type=int, default=6, help="random crops per image per epoch")
    ap.add_argument("--split", default="train", choices=["train", "all"],
                    help="train = held-out test images excluded (for evaluation); all = final model")
    ap.add_argument("--no-app-feedback", action="store_true",
                    help="leave out scans confirmed in the app (data/app-annotation.csv)")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--limit", type=int, default=0, help="limit train images (smoke test)")
    ap.add_argument("--out", default=os.path.join(ARTIFACTS, "m9_maskrcnn.pt"))
    args = ap.parse_args()

    device = pick_device(args.device)
    print(f"device: {device}")

    gyms = [g for g in all_gyms(DATA) if not args.no_app_feedback or g != APP_GYM]
    samples = sorted(load_via_index(DATA, gyms), key=lambda s: s.path)
    train = [s for s in samples if args.split == "all" or split_of(s.gym, s.path) == "train"]
    if args.limit:
        train = train[: args.limit]
    print(f"train images: {len(train)} ({args.split}) from gyms {sorted({s.gym for s in train})}")
    print(f"train instances: {sum(len(s.instances) for s in train)}")

    train_ds = HoldDataset(train, train=True, crop=args.crop, repeats=args.repeats)
    loader = torch.utils.data.DataLoader(
        train_ds, batch_size=args.batch, shuffle=True, collate_fn=collate_fn, num_workers=0
    )

    model = build_model().to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=5e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    os.makedirs(ARTIFACTS, exist_ok=True)
    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        n = 0
        for images, targets in loader:
            images = [im.to(device) for im in images]
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            loss_dict = model(images, targets)
            loss = sum(loss_dict.values())
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss.item())
            n += 1
        sched.step()
        print(f"epoch {epoch + 1}/{args.epochs}  loss {total / max(1, n):.4f}", flush=True)
        torch.save({"model": model.state_dict(), "classes": 3}, args.out)

    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
