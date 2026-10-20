"""M9 training — fine-tune Mask R-CNN on the hold/volume annotations (Mac/MPS).

Run from the parent "rock climbing" folder:
    PYTORCH_ENABLE_MPS_FALLBACK=1 ./.venv/bin/python backend/scripts/train_holds.py --epochs 60

Few labeled images, many instances each; training crops the big photos. bh is
used for train/val; sm + bh-phone are the cross-gym test set (evaluate_holds.py).
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
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=0.005)
    ap.add_argument("--crop", type=int, default=1024)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--limit", type=int, default=0, help="limit train images (smoke test)")
    ap.add_argument("--val-holdout", type=int, default=2)
    ap.add_argument("--out", default=os.path.join(ARTIFACTS, "m9_maskrcnn.pt"))
    args = ap.parse_args()

    device = pick_device(args.device)
    print(f"device: {device}")

    bh = load_via_index(DATA, ["bh"])
    bh.sort(key=lambda s: s.path)
    val = bh[: args.val_holdout]
    train = bh[args.val_holdout:]
    if args.limit:
        train = train[: args.limit]
    print(f"train images: {len(train)} | val images: {len(val)}")
    print(f"train instances: {sum(len(s.instances) for s in train)}")

    train_ds = HoldDataset(train, train=True, crop=args.crop)
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
