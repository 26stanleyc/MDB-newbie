"""Claude as a judge of climbing beta (preference labels for the planner's weights).

Shows Claude two candidate betas for the same route side by side and asks which one
a climber of the given size would actually use. The answers train the planner's cost
weights (scripts/judge_paths.py); the search still guarantees every move is in reach.

Needs ANTHROPIC_API_KEY — read from the repo's .env (gitignored) if not already set.
"""

from __future__ import annotations

import base64
import json
import os

import cv2
import numpy as np

from .env import load_env  # noqa: F401  (re-exported for scripts)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL = "claude-opus-5-5"
PANEL_MAX = 720  # px, long side of each path panel

SYSTEM = ("You are an experienced bouldering coach. You judge climbing beta (the sequence "
          "of hand and foot moves) from photos, the way a strong climber would read a route.")

PROMPT = """Climber: {height} cm tall, {span} cm wingspan.

The image shows the same bouldering route twice. White outlines are the route's holds. \
Panel A (left) and panel B (right) are two candidate betas for this climber. \
Circles are hand placements, squares are foot placements, and the numbers next to a hold are the step(s) that use it, in order (both hands start on step 1-2's hold). \
The yellow line connects hand moves. Both betas only use moves within this climber's reach. \
The route section shown is roughly {wall_m:.1f} m tall.

Which beta would most climbers of this size actually use? Consider move size, body \
position and balance, how usable the holds look, and whether the sequence flows. \
Answer "tie" only if they are essentially equally good."""

SCHEMA = {
    "type": "object",
    "properties": {
        "choice": {"type": "string", "enum": ["A", "B", "tie"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "reason": {"type": "string"},
    },
    "required": ["choice", "confidence", "reason"],
    "additionalProperties": False,
}


def _draw_path(img: np.ndarray, route_polys: list[np.ndarray], centers: dict, steps: list[dict],
               box: tuple[int, int, int, int], label: str) -> np.ndarray:
    x0, y0, x1, y1 = box
    v = img.copy()
    for p in route_polys:
        cv2.polylines(v, [p], True, (255, 255, 255), 2, cv2.LINE_AA)
    hands = [s for s in steps if s["limb"] in ("LH", "RH")]
    for a, b in zip(hands, hands[1:]):
        cv2.line(v, centers[a["holdId"]], centers[b["holdId"]], (0, 220, 255), 2, cv2.LINE_AA)
    by_hold: dict[str, list[dict]] = {}
    for s in steps:
        by_hold.setdefault(s["holdId"], []).append(s)
    for hid, ss in by_hold.items():
        x, y = centers[hid]
        if any(s["limb"] in ("LH", "RH") for s in ss):
            cv2.circle(v, (x, y), 11, (0, 200, 255), 3, cv2.LINE_AA)
        if any(s["limb"] in ("LF", "RF") for s in ss):
            cv2.rectangle(v, (x - 8, y - 8), (x + 8, y + 8), (120, 255, 120), 3)
        text = ",".join(str(s["order"]) for s in sorted(ss, key=lambda s: s["order"]))
        cv2.putText(v, text, (x + 13, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(v, text, (x + 13, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    crop = v[y0:y1, x0:x1]
    s = PANEL_MAX / max(crop.shape[:2])
    crop = cv2.resize(crop, (round(crop.shape[1] * s), round(crop.shape[0] * s)), interpolation=cv2.INTER_AREA)
    cv2.rectangle(crop, (0, 0), (46, 46), (0, 0, 0), -1)
    cv2.putText(crop, label, (10, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2, cv2.LINE_AA)
    return crop


def render_pair(img: np.ndarray, scan: dict, route_ids: list[str], steps_a: list[dict],
                steps_b: list[dict]) -> np.ndarray:
    """Side-by-side panels (A left, B right) cropped around the route."""
    H, W = img.shape[:2]
    by_id = {h["id"]: h for h in scan["holds"]}
    polys = [np.round(np.array([[p["x"] * W, p["y"] * H] for p in by_id[h]["polygon"]])).astype(np.int32)
             for h in route_ids]
    centers = {h: (int(scan["geom"][h]["center"]["x"] * W), int(scan["geom"][h]["center"]["y"] * H)) for h in route_ids}
    allp = np.concatenate(polys)
    (x0, y0), (x1, y1) = allp.min(0), allp.max(0)
    pad = int(0.15 * max(x1 - x0, y1 - y0)) + 20
    box = (max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad))
    a = _draw_path(img, polys, centers, steps_a, box, "A")
    b = _draw_path(img, polys, centers, steps_b, box, "B")
    gap = np.full((a.shape[0], 12, 3), 255, np.uint8)
    return np.hstack([a, gap, b])


def judge(client, image_bgr: np.ndarray, height: int, span: int, wall_m: float) -> dict:
    """One Claude judgment. Returns {'choice','confidence','reason'} or {'choice': None, ...}."""
    ok, buf = cv2.imencode(".jpg", image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    data = base64.standard_b64encode(buf.tobytes()).decode("utf-8")
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=SYSTEM,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
            {"type": "text", "text": PROMPT.format(height=height, span=span, wall_m=wall_m)},
        ]}],
    )
    usage = {"in": response.usage.input_tokens, "out": response.usage.output_tokens}
    if response.stop_reason == "refusal":
        return {"choice": None, "confidence": None, "reason": "refusal", "usage": usage}
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        return {"choice": None, "confidence": None, "reason": f"no text ({response.stop_reason})", "usage": usage}
    return {**json.loads(text), "usage": usage, "model": response.model}
