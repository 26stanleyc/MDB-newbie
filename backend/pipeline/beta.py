"""M12 (prototype) — personalized beta / path planner.

Established approach (cf. 1SS28/climbing-beta, Climb-5): a climb is graph search over
reachable holds under the climber's reach. We plan a **hand sequence** as a lowest-cost
path up the route's holds, then assign feet beneath each hand stance — yielding the
ordered hand/foot move list the app renders (PathStep: order, holdId, limb).

Personalization: reach limits come from height + wingspan, so a shorter climber needs
more intermediate holds (different beta), which is the whole point of the feature.

Inputs are hold centers in METERS (x right, y up) + a graspability score per hold.
Positions can come from the multi-view 3D reconstruction, or be scaled from image
coords for the prototype.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass

import numpy as np

Limb = str  # "LH" | "RH" | "LF" | "RF"


@dataclass
class Hold:
    id: str
    pos: np.ndarray        # (x, y) meters, y up
    grasp: float = 0.6     # 0..1 graspability (how good to pull on)


@dataclass
class Reach:
    """Reach limits derived from body measurements (meters)."""
    hand_move: float       # max distance a hand moves between holds
    foot_from_hand: float  # max vertical drop from a hand to its foothold
    foot_spread: float     # max lateral offset of a foot from the hand column

    @classmethod
    def from_body(cls, height_cm: float, wingspan_cm: float):
        w = wingspan_cm / 100.0
        h = height_cm / 100.0
        # A hand move is limited by arm span from a braced stance — a fraction of the
        # full wingspan (you don't fully span between consecutive grips every move).
        return cls(hand_move=0.62 * w, foot_from_hand=0.55 * h, foot_spread=0.45 * w)


@dataclass
class Step:
    order: int
    hold_id: str
    limb: Limb


MOVE_COST = 0.6       # fixed effort per hand move
MAX_DROP = 0.4        # m a hand may move down (traverses)


def _cost(a: Hold, b: Hold, reach: Reach) -> float:
    d = float(np.linalg.norm(b.pos - a.pos))          # 3D distance (works for 2D too)
    up = b.pos[1] - a.pos[1]
    lateral = abs(b.pos[0] - a.pos[0])
    # prefer: shorter moves, upward progress, good holds, staying in reach, and small
    # lateral jumps (big sideways moves risk barn-dooring = balance-aware search).
    strain = d / max(reach.hand_move, 1e-6)           # 0..1 within reach
    # MOVE_COST: every move is effort, so longer reach → fewer moves (personalization).
    return (MOVE_COST + d + 0.5 * strain + 0.8 * (1.0 - b.grasp)
            + (0.6 if up < 0 else 0.0)
            + 0.4 * lateral / max(reach.hand_move, 1e-6))


# --- Balance model (barn-door): COM must sit within the lateral span of contacts ---

def _com(stance: dict[Limb, np.ndarray]) -> np.ndarray:
    pts = np.array(list(stance.values()), dtype=float)
    com = pts.mean(0)
    com[1] -= 0.10  # hips sit a bit below the mean of grips
    return com


def stance_stability(stance: dict[Limb, np.ndarray]) -> float:
    """0..1 — how balanced a 4-(or 3-)limb stance is.

    Barn-door intuition: if every contact is on one side of the body's vertical
    line the climber swings off. Reward COM centered within the lateral span of the
    contacts, both sides straddled, and a wide base.
    """
    if len(stance) < 3:
        return 0.3
    pts = np.array(list(stance.values()), dtype=float)
    xs = pts[:, 0]
    com = _com(stance)
    lo, hi = float(xs.min()), float(xs.max())
    span = hi - lo + 1e-6
    centered = 1.0 - min(1.0, abs(com[0] - (lo + hi) / 2) / (span / 2))
    straddle = 1.0 if lo <= com[0] <= hi else 0.0
    width = min(1.0, span / 0.6)          # up to ~0.6 m base = full credit
    return float(0.5 * centered + 0.3 * straddle + 0.2 * width)


def plan_hand_path(holds: list[Hold], reach: Reach,
                   start_id: str | None = None, finish_id: str | None = None) -> list[str]:
    """Lowest-cost sequence of handholds from a start hold to the finish (highest).

    Start: given, or any hold the climber can grab while standing on the lowest hold
    (within foot_from_hand above it) — the lowest hold is usually a foothold.
    If the finish is out of reach, returns the path to the highest reachable hold.
    """
    by_id = {h.id: h for h in holds}
    finish = finish_id or max(holds, key=lambda h: h.pos[1]).id
    if start_id:
        starts = [start_id]
    else:
        floor = min(h.pos[1] for h in holds)
        starts = [h.id for h in holds if h.pos[1] - floor <= reach.foot_from_hand and h.id != finish]
        starts = starts or [min(holds, key=lambda h: h.pos[1]).id]

    # edges: holds within one hand-move; mostly upward, small drops allowed (traverses)
    adj: dict[str, list[tuple[float, str]]] = {h.id: [] for h in holds}
    for a in holds:
        for b in holds:
            if a.id == b.id:
                continue
            d = float(np.linalg.norm(b.pos - a.pos))
            if d <= reach.hand_move and (b.pos[1] - a.pos[1]) >= -MAX_DROP:
                adj[a.id].append((_cost(a, b, reach), b.id))

    # Dijkstra from every start hold at once
    dist = {h.id: float("inf") for h in holds}
    prev: dict[str, str | None] = {h.id: None for h in holds}
    pq = []
    for s in starts:
        dist[s] = 0.0
        pq.append((0.0, s))
    heapq.heapify(pq)
    while pq:
        d, u = heapq.heappop(pq)
        if u == finish:
            break
        if d > dist[u]:
            continue
        for w, v in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    target = finish
    if dist[finish] == float("inf"):  # out of reach → go as high as possible
        target = max((h for h in holds if dist[h.id] < float("inf")), key=lambda h: (h.pos[1], -dist[h.id])).id
    path = [target]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])
    return list(reversed(path))


def _foot_candidates(hand_pos: np.ndarray, holds: list[Hold], reach: Reach) -> list[Hold]:
    out = []
    for h in holds:
        drop = hand_pos[1] - h.pos[1]
        lateral = abs(h.pos[0] - hand_pos[0])
        if 0.1 <= drop <= reach.foot_from_hand and lateral <= reach.foot_spread:
            out.append(h)
    return out


def _best_foot(hand_id, holds, reach, stance, foot_limb) -> str | None:
    """Pick the foothold that most improves the stance's stability."""
    by_id = {h.id: h for h in holds}
    hp = by_id[hand_id].pos
    best, best_sc = None, -1.0
    for h in _foot_candidates(hp, holds, reach):
        trial = dict(stance); trial[foot_limb] = h.pos
        sc = stance_stability(trial) + 0.2 * h.grasp
        if sc > best_sc:
            best_sc, best = sc, h.id
    return best


def plan_beta(holds: list[Hold], height_cm: float, wingspan_cm: float,
              start_id: str | None = None, finish_id: str | None = None):
    """Full personalized beta with a balance model.

    Returns (steps, stabilities) where stabilities[k] is the stance stability (0..1)
    after move k's hand placement + its foot adjustment.
    """
    reach = Reach.from_body(height_cm, wingspan_cm)
    by_id = {h.id: h for h in holds}
    hand_path = plan_hand_path(holds, reach, start_id, finish_id)
    pos = lambda hid: by_id[hid].pos

    steps: list[Step] = []
    order = 1
    stance: dict[Limb, np.ndarray] = {}

    # start: both hands on the first hold
    stance["RH"] = pos(hand_path[0]); steps.append(Step(order, hand_path[0], "RH")); order += 1
    stance["LH"] = pos(hand_path[0]); steps.append(Step(order, hand_path[0], "LH")); order += 1
    # initial feet chosen to straddle the COM (stability)
    for foot in ("RF", "LF"):
        fid = _best_foot(hand_path[0], holds, reach, stance, foot)
        if fid:
            stance[foot] = pos(fid); steps.append(Step(order, fid, foot)); order += 1

    stabilities = [stance_stability(stance)]
    limb_cycle = ["RH", "LH"]
    for i, hid in enumerate(hand_path[1:], start=1):
        moving = limb_cycle[(i - 1) % 2]
        stance[moving] = pos(hid); steps.append(Step(order, hid, moving)); order += 1
        # reseat the opposite-side foot to rebalance under the new hand stance
        foot = "LF" if moving == "RH" else "RF"
        fid = _best_foot(hid, holds, reach, stance, foot)
        if fid and (foot not in stance or not np.array_equal(stance[foot], pos(fid))):
            stance[foot] = pos(fid); steps.append(Step(order, fid, foot)); order += 1
        stabilities.append(stance_stability(stance))
    return steps, stabilities
