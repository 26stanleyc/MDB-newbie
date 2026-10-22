"""M11 record schema (design doc §8, §10).

Light metadata lives in these dataclasses (JSON-serializable); the heavy arrays
(height map, normal map, point cloud) are stored alongside in an .npz, keyed by
hold id. Every record carries the model + pipeline versions that produced it so
the dataset can be regenerated and versioned.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PIPELINE_VERSION = "m11-0.1.0"

# --- Open spec decisions (doc §11) — chosen defaults, revisit with Stanley -----
HEIGHT_MAP_MM_PER_CELL = 2.0     # grid resolution
LOWCONF_MIN_MASK_PX = 800        # smaller masks are flagged low-confidence
LOWCONF_MAX_PLANE_NOISE_M = 0.012  # wall-fit residual std above this → noisy


@dataclass
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    source: str  # "exif" | "default"


@dataclass
class WallSurface:
    normal: list[float]       # unit, camera frame, points out of the wall toward camera
    distance_m: float         # mean wall distance
    angle_deg: float          # + overhang / - slab, vs true vertical (via gravity)
    plane_count: int
    model_version: str
    pipeline_version: str = PIPELINE_VERSION


@dataclass
class HoldSummary:
    max_protrusion_mm: float
    mean_protrusion_mm: float
    footprint_w_mm: float
    footprint_h_mm: float
    volume_mm3: float
    facing_azimuth_deg: float   # dominant surface normal, in the hold frame
    facing_elevation_deg: float


@dataclass
class HoldDepthRecord:
    hold_id: str
    label: str                  # "hold" | "volume"
    color: str
    position_norm: list[float]  # hold center, normalized image coords (0–1)
    wall_angle_deg: float
    mm_per_cell: float
    summary: HoldSummary
    confidence: float
    flags: list[str] = field(default_factory=list)
    intrinsics_source: str = "default"
    gravity_source: str = "measured"
    model_version: str = "unknown"
    pipeline_version: str = PIPELINE_VERSION
    # Heavy arrays (height_map, normal_map, point_cloud) live in the sidecar .npz.
