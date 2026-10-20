"""M9 — hold detection / segmentation.

Own instance-segmentation model, trained on Mac (MPS), so we drop the Detectron2
dependency entirely. Data is the VIA-annotated gym photos (holds + volumes).

Few images, many instances per image (up to ~325), so training uses random crops
of the big photos as augmentation; eval runs on (downscaled) full images.
"""

from __future__ import annotations

import csv
import json
import os
import random
from dataclasses import dataclass

import cv2
import numpy as np
import torch
import torchvision
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection.mask_rcnn import MaskRCNNPredictor

CLASS_NAMES = ["__background__", "hold", "volume"]
LABEL_IDS = {"hold": 1, "volume": 2}
EVAL_MAX_SIDE = 1333


@dataclass
class Instance:
    points: np.ndarray  # (K, 2) float32, image pixels
    label: int


@dataclass
class Sample:
    path: str
    gym: str
    instances: list[Instance]


def load_via_index(data_dir: str, gyms: list[str]) -> list[Sample]:
    """Parse VIA CSVs into samples for images that have >=1 polygon."""
    samples: list[Sample] = []
    for gym in gyms:
        csv_path = os.path.join(data_dir, f"{gym}-annotation.csv")
        if not os.path.exists(csv_path):
            continue
        by_file: dict[str, list[Instance]] = {}
        for row in csv.DictReader(open(csv_path)):
            try:
                shape = json.loads(row["region_shape_attributes"] or "{}")
                attrs = json.loads(row["region_attributes"] or "{}")
            except json.JSONDecodeError:
                continue
            if shape.get("name") != "polygon":
                continue
            xs, ys = shape.get("all_points_x"), shape.get("all_points_y")
            if not xs or not ys or len(xs) < 3:
                continue
            label = LABEL_IDS.get(attrs.get("hold_type", "hold"), 1)
            pts = np.stack([xs, ys], axis=1).astype("float32")
            by_file.setdefault(row["filename"], []).append(Instance(pts, label))
        for fname, insts in by_file.items():
            path = os.path.join(data_dir, gym, fname)
            if os.path.exists(path):
                samples.append(Sample(path, gym, insts))
    return samples


def _target_from_instances(
    insts: list[Instance], ox: float, oy: float, scale: float, out_w: int, out_h: int
) -> dict | None:
    """Rasterize instances into a target for a crop at (ox,oy) scaled by `scale`."""
    masks, boxes, labels = [], [], []
    for inst in insts:
        pts = (inst.points - [ox, oy]) * scale
        poly = np.round(pts).astype(np.int32)
        if poly[:, 0].max() < 0 or poly[:, 1].max() < 0 or poly[:, 0].min() >= out_w or poly[:, 1].min() >= out_h:
            continue
        m = np.zeros((out_h, out_w), np.uint8)
        cv2.fillPoly(m, [poly], 1)
        ys, xs = np.where(m)
        if xs.size == 0:
            continue
        x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        masks.append(m)
        boxes.append([x1, y1, x2 + 1, y2 + 1])
        labels.append(inst.label)
    if not masks:
        return None
    return {
        "boxes": torch.as_tensor(boxes, dtype=torch.float32),
        "labels": torch.as_tensor(labels, dtype=torch.int64),
        "masks": torch.as_tensor(np.stack(masks), dtype=torch.uint8),
        "area": torch.as_tensor(
            [(b[2] - b[0]) * (b[3] - b[1]) for b in boxes], dtype=torch.float32
        ),
        "iscrowd": torch.zeros(len(masks), dtype=torch.int64),
    }


class HoldDataset(torch.utils.data.Dataset):
    def __init__(self, samples: list[Sample], train: bool, crop: int = 1024, seed: int = 0):
        self.samples = samples
        self.train = train
        self.crop = crop
        self.rng = random.Random(seed)

    def __len__(self) -> int:
        return len(self.samples)

    def _load_rgb(self, path: str) -> np.ndarray:
        bgr = cv2.imread(path)
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    def __getitem__(self, i: int):
        for _ in range(8):  # retry until a crop contains instances
            s = self.samples[i]
            img = self._load_rgb(s.path)
            h, w = img.shape[:2]

            if self.train:
                c = min(self.crop, h, w)
                anchor = self.rng.choice(s.instances).points.mean(0)
                ox = int(np.clip(anchor[0] - c / 2 + self.rng.randint(-c // 4, c // 4), 0, max(0, w - c)))
                oy = int(np.clip(anchor[1] - c / 2 + self.rng.randint(-c // 4, c // 4), 0, max(0, h - c)))
                crop_img = img[oy:oy + c, ox:ox + c]
                target = _target_from_instances(s.instances, ox, oy, 1.0, crop_img.shape[1], crop_img.shape[0])
                if target is None:
                    i = self.rng.randrange(len(self.samples))
                    continue
                if self.rng.random() < 0.5:  # horizontal flip
                    crop_img = crop_img[:, ::-1].copy()
                    cw = crop_img.shape[1]
                    target["masks"] = torch.flip(target["masks"], dims=[2])
                    b = target["boxes"].clone()
                    b[:, 0], b[:, 2] = cw - target["boxes"][:, 2], cw - target["boxes"][:, 0]
                    target["boxes"] = b
                out = crop_img
            else:
                scale = min(1.0, EVAL_MAX_SIDE / max(h, w))
                out = cv2.resize(img, (round(w * scale), round(h * scale))) if scale < 1 else img
                target = _target_from_instances(s.instances, 0, 0, scale, out.shape[1], out.shape[0])
                if target is None:
                    target = {
                        "boxes": torch.zeros((0, 4), dtype=torch.float32),
                        "labels": torch.zeros((0,), dtype=torch.int64),
                        "masks": torch.zeros((0, out.shape[0], out.shape[1]), dtype=torch.uint8),
                        "area": torch.zeros((0,), dtype=torch.float32),
                        "iscrowd": torch.zeros((0,), dtype=torch.int64),
                    }

            target["image_id"] = torch.tensor([i])
            tensor = torch.as_tensor(out.transpose(2, 0, 1), dtype=torch.float32) / 255.0
            return tensor, target
        raise RuntimeError("could not sample a crop with instances")


def build_model(num_classes: int = 3):
    model = torchvision.models.detection.maskrcnn_resnet50_fpn(weights="DEFAULT")
    in_feat = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_feat, num_classes)
    in_mask = model.roi_heads.mask_predictor.conv5_mask.in_channels
    model.roi_heads.mask_predictor = MaskRCNNPredictor(in_mask, 256, num_classes)
    return model


def collate_fn(batch):
    return tuple(zip(*batch))
