"""Learn the planner's cost weights from Claude's beta preferences.

  consistency  Ask Claude about N path pairs twice (A/B order swapped). If it picks
               the same path both times often enough, its preferences are signal.
  collect      Ask about more pairs (both orders) for fitting.
  fit          Bradley-Terry / logistic regression on path-feature differences →
               weights for pipeline/beta.py (λ by 5-fold CV over routes on train),
               scored on held-out test-split pairs. --save writes eval/planner_weights.json,
               which the planner then uses.
  reach        Current hand reach vs shorter fractions of wingspan (--fracs), judged by
               Claude on routes where the paths differ (use --split test for held-out).

Pairs come from the hand-labeled routes (backend/eval/route_colors.json); candidate
paths are planner outputs under randomly perturbed weights, so every candidate is
reachable. Judgments are appended to backend/eval/claude_judgments.jsonl — re-runs
reuse them instead of paying again.

Run from the parent "rock climbing" folder (calls the Claude API — costs money):
    ./.venv/bin/python backend/scripts/judge_paths.py consistency --pairs 25
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from pipeline.beta import DEFAULT_WEIGHTS, FEATURES, Hold as BetaHold, Reach, path_features, plan_beta  # noqa: E402
from pipeline.claude_judge import judge, load_env, render_pair  # noqa: E402
from pipeline.holds import load_via_index  # noqa: E402
from pipeline.scan import build_scan, detection_from_mask, meters_per_pixel, working_image  # noqa: E402
from pipeline.splits import all_gyms, split_of  # noqa: E402

DATA = os.path.join(ROOT, "data")
LOG = os.path.join(BACKEND, "eval", "claude_judgments.jsonl")
IMG_DIR = os.path.join(BACKEND, "artifacts", "judge")
CLIMBERS = [(155, 155), (170, 172), (185, 190)]
WEIGHT_SAMPLES = 40


def labeled_routes(split: str):
    """Yield (key, img, scan, route_hold_ids) for every labeled route with >= 4 holds."""
    colors = json.load(open(os.path.join(BACKEND, "eval", "route_colors.json")))
    for s in load_via_index(DATA, all_gyms(DATA)):
        key = f"{s.gym}/{os.path.basename(s.path)}"
        if key not in colors or split_of(s.gym, s.path) != split:
            continue
        bgr = cv2.imread(s.path)
        img = working_image(bgr)
        H, W = img.shape[:2]
        sc = W / bgr.shape[1]
        dets, rid_of = [], []
        for inst in s.instances:
            m = np.zeros((H, W), np.uint8)
            cv2.fillPoly(m, [np.round(inst.points * sc).astype(np.int32)], 1)
            d = detection_from_mask(m.astype(bool), 1.0, "volume" if inst.label == 2 else "hold")
            if d:
                dets.append(d)
                rid_of.append(inst.route_id)
        scan = build_scan(img, dets, "g", namer=False)
        routes: dict[str, list[str]] = {}
        for h, rid in zip(scan["holds"], rid_of):
            if rid in colors[key]:
                routes.setdefault(rid, []).append(h["id"])
        for rid, ids in sorted(routes.items()):
            if len(ids) >= 4:
                yield f"{key}#{rid}", img, scan, ids


def route_holds(scan: dict, ids: list[str]) -> list[BetaHold]:
    W, H = scan["imageSize"]
    mpp = meters_per_pixel(scan["geom"], scan["imageSize"])
    return [BetaHold(h, np.array([scan["geom"][h]["center"]["x"] * W * mpp,
                                  (1 - scan["geom"][h]["center"]["y"]) * H * mpp])) for h in ids]


def candidates(scan: dict, ids: list[str], height: int, span: int, rng: random.Random):
    """Distinct planner paths under perturbed weights: list of (weights, steps, features)."""
    holds = route_holds(scan, ids)
    reach = Reach.from_body(height, span)
    seen, out = set(), []
    for k in range(WEIGHT_SAMPLES):
        w = DEFAULT_WEIGHTS if k == 0 else DEFAULT_WEIGHTS * np.exp([rng.uniform(-2.3, 2.3) for _ in FEATURES])
        steps, _ = plan_beta(holds, height, span, weights=w)
        hand = tuple(s.hold_id for s in steps if s.limb in ("LH", "RH"))[1:]  # drop the duplicate start
        if len(hand) >= 2 and hand not in seen:
            seen.add(hand)
            out.append((w, [{"order": s.order, "holdId": s.hold_id, "limb": s.limb} for s in steps],
                        path_features(list(hand), holds, reach)))
    return out


def make_pairs(split: str, n: int, seed: int):
    rng = random.Random(seed)
    pool = []
    for key, img, scan, ids in labeled_routes(split):
        for height, span in CLIMBERS:
            cands = candidates(scan, ids, height, span, rng)
            if len(cands) >= 2:
                pool.append((key, img, scan, ids, height, span, cands))
    rng.shuffle(pool)
    pairs = []
    for i in range(n):
        key, img, scan, ids, height, span, cands = pool[i % len(pool)]
        p, q = rng.sample(cands, 2)
        pairs.append((key, img, scan, ids, height, span, p, q))
    return pairs, len(pool)


def ask_both_orders(client, pair, idx: int, tag: str) -> list[dict]:
    key, img, scan, ids, height, span, p, q = pair
    W, H = scan["imageSize"]
    ys = [scan["geom"][h]["center"]["y"] for h in ids]
    wall_m = (max(ys) - min(ys)) * H * meters_per_pixel(scan["geom"], scan["imageSize"]) + 0.5
    out = []
    for order, (a, b) in (("pq", (p, q)), ("qp", (q, p))):
        pic = render_pair(img, scan, ids, a[1], b[1])
        os.makedirs(IMG_DIR, exist_ok=True)
        cv2.imwrite(os.path.join(IMG_DIR, f"{tag}_{idx:03d}_{order}.jpg"), pic)
        r = judge(client, pic, height, span, wall_m)
        winner = None if r["choice"] in (None, "tie") else (
            ("p" if r["choice"] == "A" else "q") if order == "pq" else ("q" if r["choice"] == "A" else "p"))
        out.append({"tag": tag, "pair": idx, "route": key, "height": height, "span": span, "order": order,
                    "choice": r["choice"], "winner": winner, "confidence": r["confidence"], "reason": r["reason"],
                    "features_p": p[2].round(4).tolist(), "features_q": q[2].round(4).tolist(),
                    "hands_p": [s["holdId"] for s in p[1] if s["limb"] in ("LH", "RH")],
                    "hands_q": [s["holdId"] for s in q[1] if s["limb"] in ("LH", "RH")],
                    "usage": r.get("usage")})
    return out


def run_judging(split: str, n: int, seed: int, tag: str, workers: int) -> list[dict]:
    import anthropic
    load_env()
    client = anthropic.Anthropic()
    pairs, pool = make_pairs(split, n, seed)
    print(f"{pool} route/climber combos with >= 2 distinct candidate paths; judging {len(pairs)} pairs x 2 orders")
    records = []
    with ThreadPoolExecutor(workers) as ex:
        for recs in ex.map(lambda ip: ask_both_orders(client, ip[1], ip[0], tag), enumerate(pairs)):
            records += recs
            with open(LOG, "a") as f:
                for r in recs:
                    f.write(json.dumps(r) + "\n")
            print(f"  pair {recs[0]['pair']}: {recs[0]['choice']}/{recs[1]['choice']} -> "
                  f"{recs[0]['winner']}/{recs[1]['winner']}", flush=True)
    return records


def consistency_report(records: list[dict]) -> dict:
    by_pair: dict[tuple, dict] = {}
    for r in records:
        by_pair.setdefault((r["tag"], r["pair"]), {})[r["order"]] = r
    both = [v for v in by_pair.values() if "pq" in v and "qp" in v]
    decided = [v for v in both if v["pq"]["winner"] and v["qp"]["winner"]]
    agree = sum(v["pq"]["winner"] == v["qp"]["winner"] for v in decided)
    a_first = sum(r["choice"] == "A" for r in records) / max(1, len(records))
    tokens_in = sum((r.get("usage") or {}).get("in", 0) for r in records)
    tokens_out = sum((r.get("usage") or {}).get("out", 0) for r in records)
    return {"pairs": len(both), "both_decided": len(decided),
            "same_path_both_orders": round(agree / max(1, len(decided)), 3),
            "ties_or_refusals": sum(1 for r in records if r["winner"] is None),
            "picked_A_rate": round(a_first, 3), "tokens_in": tokens_in, "tokens_out": tokens_out}


# --- fitting ---------------------------------------------------------------------

WEIGHTS_FILE = os.path.join(BACKEND, "eval", "planner_weights.json")
LAMBDAS = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]


def load_records(split: str) -> list[dict]:
    """Decided judgments (a winner) whose route is in `split`."""
    out = []
    for line in open(LOG):
        r = json.loads(line)
        gym, rest = r["route"].split("/", 1)
        if r["winner"] and split_of(gym, rest.split("#")[0]) == split:
            out.append(r)
    return out


def diffs(records: list[dict]) -> np.ndarray:
    """Rows d = F(loser) - F(winner): Claude's choice is right when w·d > 0."""
    rows = []
    for r in records:
        fp, fq = np.array(r["features_p"]), np.array(r["features_q"])
        rows.append(fq - fp if r["winner"] == "p" else fp - fq)
    return np.array(rows)


def fit_weights(D: np.ndarray, lam: float) -> np.ndarray:
    """Logistic (Bradley-Terry) fit, weights >= 0, L2 pull toward the hand-set weights
    so a few hundred judgments can't swing them arbitrarily."""
    from scipy.optimize import minimize

    def loss(w):
        z = D @ w
        return np.mean(np.logaddexp(0, -z)) + lam * np.sum((w - DEFAULT_WEIGHTS) ** 2)

    def grad(w):
        z = D @ w
        g = -(D * (1 / (1 + np.exp(z)))[:, None]).mean(0)
        return g + 2 * lam * (w - DEFAULT_WEIGHTS)

    res = minimize(loss, DEFAULT_WEIGHTS.copy(), jac=grad, method="L-BFGS-B",
                   bounds=[(0, None)] * len(DEFAULT_WEIGHTS))
    return res.x


def agreement(D: np.ndarray, w: np.ndarray) -> float | None:
    if len(D) == 0:
        return None
    z = D @ w
    return float(np.mean(np.where(np.abs(z) < 1e-9, 0.5, z > 0)))


def fit_command() -> dict:
    train, test = load_records("train"), load_records("test")
    Dtr, Dte = diffs(train), diffs(test)
    routes = sorted({r["route"] for r in train})
    folds = [set(routes[i::5]) for i in range(5)]  # 5 folds by route: no pair leaks across
    cv = {}
    for lam in LAMBDAS:
        accs = []
        for f in folds:
            tr = np.array([r["route"] not in f for r in train])
            if tr.all() or not tr.any():
                continue
            accs.append(agreement(Dtr[~tr], fit_weights(Dtr[tr], lam)))
        cv[lam] = float(np.mean(accs))
    best = max(cv, key=cv.get)
    w = fit_weights(Dtr, best)
    result = {
        "features": list(FEATURES),
        "weights": [round(float(x), 4) for x in w],
        "hand_set_weights": DEFAULT_WEIGHTS.tolist(),
        "lambda": best, "cv_agreement_by_lambda": {str(k): round(v, 3) for k, v in cv.items()},
        "train_judgments": len(train), "test_judgments": len(test),
        "test_agreement_learned": agreement(Dte, w),
        "test_agreement_hand_set": agreement(Dte, DEFAULT_WEIGHTS),
        "source": "Claude (claude-opus-5-5) pairwise beta preferences, backend/eval/claude_judgments.jsonl",
    }
    return result


# --- reach model test -------------------------------------------------------------

def reach_command(split: str, fracs: list[float], workers: int) -> dict:
    """Current hand reach (HAND_REACH_FRAC) vs shorter ones: Claude judges each route /
    climber where the two settings give different hand sequences."""
    import anthropic
    from collections import Counter
    from pipeline.beta import HAND_REACH_FRAC
    load_env()
    client = anthropic.Anthropic()
    as_dicts = lambda steps: [{"order": x.order, "holdId": x.hold_id, "limb": x.limb} for x in steps]  # noqa: E731
    hands_of = lambda steps: [x["holdId"] for x in steps if x["limb"] in ("LH", "RH")]  # noqa: E731
    jobs, stats = [], {f: Counter() for f in fracs}
    for key, img, scan, ids in labeled_routes(split):
        holds = route_holds(scan, ids)
        top = max(holds, key=lambda h: h.pos[1]).id
        for height, span in CLIMBERS:
            base = as_dicts(plan_beta(holds, height, span, hand_frac=HAND_REACH_FRAC)[0])
            for f in fracs:
                alt = as_dicts(plan_beta(holds, height, span, hand_frac=f)[0])
                st = stats[f]
                st["combos"] += 1
                st["base_reaches_top"] += hands_of(base)[-1] == top
                st["alt_reaches_top"] += hands_of(alt)[-1] == top
                st["base_moves"] += len(hands_of(base)) - 2
                st["alt_moves"] += len(hands_of(alt)) - 2
                if hands_of(alt) != hands_of(base):
                    st["differ"] += 1
                    feats = lambda steps: path_features(hands_of(steps)[1:], holds, Reach.from_body(height, span))  # noqa: E731
                    jobs.append((f, (key, img, scan, ids, height, span, (None, base, feats(base)), (f, alt, feats(alt)))))
    print(f"{len(jobs)} differing route/climber/reach cases to judge (x2 orders)")
    tag = f"reach-{split}"

    def run(i_job):
        i, (f, pair) = i_job
        recs = ask_both_orders(client, pair, i, tag)
        for r in recs:
            r["base_frac"], r["alt_frac"] = HAND_REACH_FRAC, f  # p = current reach, q = shorter
        return f, recs

    votes = {f: Counter() for f in fracs}
    with ThreadPoolExecutor(workers) as ex:
        for f, recs in ex.map(run, enumerate(jobs)):
            with open(LOG, "a") as fh:
                for r in recs:
                    fh.write(json.dumps(r) + "\n")
            w = [r["winner"] for r in recs]
            votes[f]["alt_votes"] += w.count("q")
            votes[f]["base_votes"] += w.count("p")
            votes[f]["pairs_alt_both"] += w == ["q", "q"]
            votes[f]["pairs_base_both"] += w == ["p", "p"]
            votes[f]["pairs_split"] += w.count("q") == 1
    out = {}
    for f in fracs:
        st, v = stats[f], votes[f]
        n = st["combos"]
        decided = v["alt_votes"] + v["base_votes"]
        out[str(f)] = {
            "combos": n, "paths_differ": st["differ"],
            "claude_prefers_shorter_reach": round(v["alt_votes"] / decided, 3) if decided else None,
            "pairs_shorter_both_orders": v["pairs_alt_both"], "pairs_current_both_orders": v["pairs_base_both"],
            "pairs_split": v["pairs_split"],
            "reaches_top_current": round(st["base_reaches_top"] / n, 3),
            "reaches_top_shorter": round(st["alt_reaches_top"] / n, 3),
            "mean_moves_current": round(st["base_moves"] / n, 2),
            "mean_moves_shorter": round(st["alt_moves"] / n, 2),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["consistency", "collect", "fit", "reach"])
    ap.add_argument("--fracs", type=float, nargs="+", default=[0.55, 0.45],
                    help="reach: shorter hand-reach fractions of wingspan to test")
    ap.add_argument("--save", action="store_true", help="fit: write backend/eval/planner_weights.json")
    ap.add_argument("--pairs", type=int, default=25)
    ap.add_argument("--split", default="train", choices=["train", "test"])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    if args.command == "fit":
        result = fit_command()
        print(json.dumps(result, indent=1))
        if args.save:
            with open(WEIGHTS_FILE, "w") as f:
                json.dump(result, f, indent=1)
            print(f"saved {WEIGHTS_FILE}")
        return 0
    if args.command == "reach":
        print(json.dumps(reach_command(args.split, args.fracs, args.workers), indent=1))
        return 0
    tag = f"{args.command}-{args.split}-s{args.seed}"
    records = run_judging(args.split, args.pairs, args.seed, tag, args.workers)
    print(json.dumps(consistency_report(records), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
