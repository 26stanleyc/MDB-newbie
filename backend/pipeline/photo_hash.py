"""Photo fingerprint (64-bit difference hash) to spot the same photo uploaded twice.

Re-encoding or resizing barely changes it, so a few differing bits still mean "same
photo". Used by the server (scan.photoHash → the app keeps one saved wall per photo)
and scripts/export_feedback.py (one training copy per photo).
"""

from __future__ import annotations

import cv2
import numpy as np

SAME_PHOTO_BITS = 6  # differing bits (of 64) below which two photos count as the same


def dhash(bgr: np.ndarray) -> int:
    g = cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (9, 8), interpolation=cv2.INTER_AREA)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def dhash_hex(bgr: np.ndarray) -> str:
    return f"{dhash(bgr):016x}"


def distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")
