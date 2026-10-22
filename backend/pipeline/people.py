"""Drop "holds" that are really people (climbers, spectators) in front of the wall.

The hold detector was trained on walls with few people, so bodies and heads standing
in front of a wall often come out as large holds — at any confidence (0.58–1.0 on a
phone scan), so no score cutoff removes them. torchvision's COCO Mask R-CNN (the
same weights the hold model was fine-tuned from, already in the torch cache) finds
people; a hold whose mask lies mostly inside a person is dropped. Holds a climber is
merely touching stay: only a small part of them is covered.
"""

from __future__ import annotations

import threading

import cv2
import numpy as np
import torch
from torchvision.models.detection import MaskRCNN_ResNet50_FPN_Weights, maskrcnn_resnet50_fpn

PERSON_LABEL = 1         # COCO category "person"
PERSON_SCORE_MIN = 0.7
COVERED_FRAC = 0.5       # drop a hold when at least this share of it is inside a person

_model = None
_device = None
_lock = threading.Lock()


def _get_model():
    global _model, _device
    with _lock:
        if _model is None:
            _device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
            _model = maskrcnn_resnet50_fpn(weights=MaskRCNN_ResNet50_FPN_Weights.COCO_V1).to(_device).eval()
        return _model, _device


def person_mask(img: np.ndarray) -> np.ndarray:
    """Union of every confident person mask in a BGR image (bool, same size)."""
    model, device = _get_model()
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    tensor = torch.as_tensor(rgb.transpose(2, 0, 1), dtype=torch.float32) / 255.0
    with _lock, torch.no_grad():
        out = model([tensor.to(device)])[0]
    keep = (out["labels"] == PERSON_LABEL) & (out["scores"] >= PERSON_SCORE_MIN)
    masks = out["masks"][keep].squeeze(1).cpu().numpy() > 0.5
    return masks.any(axis=0) if len(masks) else np.zeros(img.shape[:2], bool)


def drop_people(dets: list[dict], people: np.ndarray) -> list[dict]:
    """Detections (from scan.detect_holds) without the ones that are mostly a person."""
    if not people.any():
        return dets
    return [d for d in dets if (d["mask"] & people).sum() < COVERED_FRAC * d["mask"].sum()]
