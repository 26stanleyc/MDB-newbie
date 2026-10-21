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
    route_id: str | None = None  # VIA route_id, where labeled


@dataclass
class Sample:
    path: str
    gym: str
    instances: list[Instance]


# bh-phone polygons were drawn on a half-size copy of each (EXIF-rotated) photo;
# scale them up to the full-res image that cv2.imread returns.
ANNOTATION_SCALE = {"bh-phone": 2.0}


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
            pts = np.stack([xs, ys], axis=1).astype("float32") * ANNOTATION_SCALE.get(gym, 1.0)
            rid = attrs.get("route_id")
            by_file.setdefault(row["filename"], []).append(
                Instance(pts, label, str(rid) if rid not in ("", None) else None))
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
    """Train mode: random crops at a random scale around the app's working resolution
    (inference runs on images downscaled to EVAL_MAX_SIDE, so holds must be seen at
    that size), plus flips and lighting jitter. `repeats` crops per image per epoch."""

    def __init__(self, samples: list[Sample], train: bool, crop: int = 800, seed: int = 0,
                 scale_range: tuple[float, float] = (0.7, 2.0), repeats: int = 1):
        self.samples = samples
        self.train = train
        self.crop = crop
        self.scale_range = scale_range  # relative to the working (inference) resolution
        self.repeats = repeats if train else 1
        self.rng = random.Random(seed)

    def __len__(self) -> int:
        return len(self.samples) * self.repeats

    def _jitter(self, rgb: np.ndarray) -> np.ndarray:
        """Brightness / contrast / saturation jitter — gyms are dim and unevenly lit."""
        out = rgb.astype(np.float32)
        out = (out - 128) * self.rng.uniform(0.7, 1.3) + 128 + self.rng.uniform(-30, 30)
        gray = out.mean(axis=2, keepdims=True)
        out = gray + (out - gray) * self.rng.uniform(0.7, 1.3)
        return np.clip(out, 0, 255).astype(np.uint8)

    def _load_rgb(self, path: str) -> np.ndarray:
        bgr = cv2.imread(path)
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    def __getitem__(self, i: int):
        i = i % len(self.samples)
        for _ in range(8):  # retry until a crop contains instances
            s = self.samples[i]
            img = self._load_rgb(s.path)
            h, w = img.shape[:2]

            if self.train:
                r = min(1.0, EVAL_MAX_SIDE / max(h, w) * self.rng.uniform(*self.scale_range))
                if r < 1.0:
                    img = cv2.resize(img, (round(w * r), round(h * r)), interpolation=cv2.INTER_AREA)
                h, w = img.shape[:2]
                c = min(self.crop, h, w)
                anchor = self.rng.choice(s.instances).points.mean(0) * r
                ox = int(np.clip(anchor[0] - c / 2 + self.rng.randint(-c // 4, c // 4), 0, max(0, w - c)))
                oy = int(np.clip(anchor[1] - c / 2 + self.rng.randint(-c // 4, c // 4), 0, max(0, h - c)))
                crop_img = img[oy:oy + c, ox:ox + c]
                target = _target_from_instances(s.instances, ox / r, oy / r, r, crop_img.shape[1], crop_img.shape[0])
                crop_img = self._jitter(crop_img)
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


def build_detectron2_model(path: str):
    """Load the pre-trained Detectron2 hold model (data/model/model_final.pth) into
    torchvision's Mask R-CNN, so it can be evaluated without installing Detectron2.

    Same R50-FPN architecture; differences handled here: Detectron2's weight names,
    class order (background last vs first), anchor order (size-major vs ratio-major,
    2 sizes x 3 ratios per level), stride on the 1x1 conv (MSRA ResNet), BGR 0-255
    input, and ROIAlignV2 (aligned=True).
    """
    import functools

    import torchvision.ops.poolers as poolers
    from torchvision.models.detection.anchor_utils import AnchorGenerator
    from torchvision.ops import roi_align

    poolers.roi_align = functools.partial(roi_align, aligned=True)  # ROIAlignV2

    sizes, ratios = (32, 64), (0.5, 1.0, 2.0)
    model = torchvision.models.detection.maskrcnn_resnet50_fpn(
        weights=None, weights_backbone=None, num_classes=3,
        rpn_anchor_generator=AnchorGenerator((sizes,) * 5, (ratios,) * 5),
        # BGR channel flip is folded into conv1 below, so the model takes RGB in [0,1].
        image_mean=[123.675 / 255, 116.28 / 255, 103.53 / 255], image_std=[1 / 255] * 3,
        rpn_pre_nms_top_n_test=12000, rpn_post_nms_top_n_test=2000,
        box_score_thresh=0.05, box_nms_thresh=0.5, box_detections_per_img=100,
    )
    # MSRA ResNet: the stride-2 conv is the 1x1, not the 3x3.
    for layer in (model.backbone.body.layer2, model.backbone.body.layer3, model.backbone.body.layer4):
        layer[0].conv1.stride, layer[0].conv2.stride = (2, 2), (1, 1)

    d2 = torch.load(path, map_location="cpu", weights_only=True)["model"]
    sd = {}

    def bn(dst: str, src: str):
        for p in ("weight", "bias", "running_mean", "running_var"):
            sd[f"{dst}.{p}"] = d2[f"{src}.{p}"]

    sd["backbone.body.conv1.weight"] = d2["backbone.bottom_up.stem.conv1.weight"].flip(1)  # BGR -> RGB
    bn("backbone.body.bn1", "backbone.bottom_up.stem.conv1.norm")
    for li, n_blocks in enumerate((3, 4, 6, 3)):
        for b in range(n_blocks):
            dst, src = f"backbone.body.layer{li + 1}.{b}", f"backbone.bottom_up.res{li + 2}.{b}"
            for c in (1, 2, 3):
                sd[f"{dst}.conv{c}.weight"] = d2[f"{src}.conv{c}.weight"]
                bn(f"{dst}.bn{c}", f"{src}.conv{c}.norm")
            if b == 0:
                sd[f"{dst}.downsample.0.weight"] = d2[f"{src}.shortcut.weight"]
                bn(f"{dst}.downsample.1", f"{src}.shortcut.norm")
    for i in range(4):
        for p in ("weight", "bias"):
            sd[f"backbone.fpn.inner_blocks.{i}.0.{p}"] = d2[f"backbone.fpn_lateral{i + 2}.{p}"]
            sd[f"backbone.fpn.layer_blocks.{i}.0.{p}"] = d2[f"backbone.fpn_output{i + 2}.{p}"]

    # RPN: Detectron2 anchor index = size * n_ratios + ratio; torchvision = ratio * n_sizes + size.
    perm = [s * len(ratios) + r for r in range(len(ratios)) for s in range(len(sizes))]
    perm4 = [4 * a + k for a in perm for k in range(4)]
    rpn = "proposal_generator.rpn_head"
    for p in ("weight", "bias"):
        sd[f"rpn.head.conv.0.0.{p}"] = d2[f"{rpn}.conv.{p}"]
        sd[f"rpn.head.cls_logits.{p}"] = d2[f"{rpn}.objectness_logits.{p}"][perm]
        sd[f"rpn.head.bbox_pred.{p}"] = d2[f"{rpn}.anchor_deltas.{p}"][perm4]

    # Box head + predictor: background moves from last (Detectron2) to first.
    for p in ("weight", "bias"):
        sd[f"roi_heads.box_head.fc6.{p}"] = d2[f"roi_heads.box_head.fc1.{p}"]
        sd[f"roi_heads.box_head.fc7.{p}"] = d2[f"roi_heads.box_head.fc2.{p}"]
        cls = d2[f"roi_heads.box_predictor.cls_score.{p}"]
        sd[f"roi_heads.box_predictor.cls_score.{p}"] = cls[[2, 0, 1]]
        reg = d2[f"roi_heads.box_predictor.bbox_pred.{p}"]
        sd[f"roi_heads.box_predictor.bbox_pred.{p}"] = torch.cat([torch.zeros_like(reg[:4]), reg])
        for i in range(4):
            sd[f"roi_heads.mask_head.{i}.0.{p}"] = d2[f"roi_heads.mask_head.mask_fcn{i + 1}.{p}"]
        sd[f"roi_heads.mask_predictor.conv5_mask.{p}"] = d2[f"roi_heads.mask_head.deconv.{p}"]
        logits = d2[f"roi_heads.mask_head.predictor.{p}"]
        sd[f"roi_heads.mask_predictor.mask_fcn_logits.{p}"] = torch.cat([torch.zeros_like(logits[:1]), logits])

    missing, unexpected = model.load_state_dict(sd, strict=False)
    missing = [k for k in missing if not k.endswith("num_batches_tracked")]
    assert not missing and not unexpected, (missing, unexpected)
    return model


def collate_fn(batch):
    return tuple(zip(*batch))
