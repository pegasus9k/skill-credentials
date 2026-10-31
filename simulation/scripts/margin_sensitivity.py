"""Sensitivity of the competency graph to the margin of Equation 5.1.

Reads graphStructure.json, courses.json and archetypes.json, the inputs of
thresholds.py, and nothing from the simulated year, so no drawn grade and no
replay result enters the analysis. The thresholds come from derive() of
thresholds.py and the allocations from allocate() of allocate.py, the same code
that writes graph.json.

1. Completion sweep. For each margin from 0.50 to 1.00, in steps of 0.01, a
   student who earns every badge of an archetype allocates them to its target
   nodes. Writes margin_completion.csv, one row per margin and archetype.
2. One missed badge. For the margins 0.6, 0.7 and 0.8, one badge at a time is
   removed from the full badge set of each archetype, and the rest allocated
   again. A case counts once if at least one target node can no longer be
   unlocked. Writes margin_one_missed.csv, one row per margin, archetype and
   missed badge.

Prints a summary of both. Needs SciPy, like thresholds.py.

Usage: python3 margin_sensitivity.py [--spec DIR] [--out DIR] [--jobs N]
       Reads the files of ../spec and writes the two CSV files to the current
       directory. With two processes it takes about ten minutes.
"""
import argparse
import copy
import csv
import os
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from allocate import allocate
from thresholds import PERIODS, SPEC, derive, load

SWEEP = [f"{i / 100:.2f}" for i in range(50, 101)]
ONE_MISSED = ["0.60", "0.70", "0.80"]


def graph_nodes(structure, margin, archetypes):
    """The nodes as allocate() takes them, with the thresholds derived for the
    margin. The margin is a decimal string, which derive() reads exactly."""
    s = copy.deepcopy(structure)
    s["derivation"]["margin"] = margin
    thr = derive(s, archetypes)
    return {n["id"]: {"threshold": thr[n["id"]], "prerequisiteGroups": n["prerequisiteGroups"]}
            for n in structure["nodes"]}


def solve(job):
    """One allocation. Returns the key of the job, the target nodes that are
    not unlocked and the points allocated."""
    key, pool, targets, nodes = job
    result = allocate(pool, targets, nodes)
    used = {i for ids in result.values() for i in ids}
    lost = [n for n in targets if n not in result]
    return key, lost, sum(b["points"] for b in pool if b["id"] in used)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=SPEC, help="directory of the specification files")
    ap.add_argument("--out", default=".", help="directory for the two CSV files")
    ap.add_argument("--jobs", type=int, default=os.cpu_count(), help="number of processes")
    args = ap.parse_args()

    structure = load(os.path.join(args.spec, "graphStructure.json"))
    courses = load(os.path.join(args.spec, "courses.json"))["courses"]
    archetypes = load(os.path.join(args.spec, "archetypes.json"))["archetypes"]
    badges = {c["code"]: c["badges"] for c in courses}
    # Same badge order as completion_check() of thresholds.py, so ties are
    # broken the same way.
    pools = {a["id"]: [b for p in PERIODS for c in a["courses"][p] for b in badges[c]] for a in archetypes}

    nodes = {m: graph_nodes(structure, m, archetypes) for m in sorted(set(SWEEP) | set(ONE_MISSED))}

    # The analysis must use the thresholds of the thesis at the margin of
    # graphStructure.json.
    margin = f"{float(structure['derivation']['margin']):.2f}"
    graph_path = os.path.join(args.spec, "graph.json")
    if os.path.exists(graph_path):
        graph = {n["id"]: n["threshold"] for n in load(graph_path)["nodes"]}
        same = all(nodes[margin][n]["threshold"] == graph[n] for n in graph)
        print(f"At {margin}, the derived thresholds {'match' if same else 'DO NOT match'} graph.json")

    jobs = []
    for m in SWEEP:
        for a in archetypes:
            jobs.append((("sweep", m, a["id"], ""), pools[a["id"]], a["targetNodes"], nodes[m]))
    for m in ONE_MISSED:
        for a in archetypes:
            pool = pools[a["id"]]
            for i, b in enumerate(pool):
                jobs.append((("missed", m, a["id"], b["id"]), pool[:i] + pool[i + 1:], a["targetNodes"], nodes[m]))

    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        results = list(ex.map(solve, jobs, chunksize=4))

    sweep = [(k[1], k[2], lost, pts) for k, lost, pts in results if k[0] == "sweep"]
    missed = [(k[1], k[2], k[3], lost, pts) for k, lost, pts in results if k[0] == "missed"]

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "margin_completion.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["margin", "archetype", "unlocks_all_targets", "lost_nodes", "points_allocated"])
        for m, aid, lost, pts in sweep:
            w.writerow([m, aid, "yes" if not lost else "no", " ".join(map(str, lost)), pts])
    with open(os.path.join(args.out, "margin_one_missed.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["margin", "archetype", "missed_badge", "unlocks_all_targets", "lost_nodes", "points_allocated"])
        for m, aid, bid, lost, pts in missed:
            w.writerow([m, aid, bid, "yes" if not lost else "no", " ".join(map(str, lost)), pts])

    # Summary of the completion sweep.
    failing = sorted({m for m, _, lost, _ in sweep if lost})
    upper = max((m for m in SWEEP if all(f > m for f in failing)), default=None)
    print(f"With every badge, every archetype unlocks all its target nodes for margins up to {upper}")
    for m in failing[:3]:
        cases = [f"{aid} loses node {', '.join(map(str, lost))}" for mm, aid, lost, _ in sweep if mm == m and lost]
        print(f"  at {m}: {'; '.join(cases)}")
    if len(failing) > 3:
        print(f"  and {len(failing) - 3} more margins up to {failing[-1]}")

    # Summary of the missed badges.
    for m in ONE_MISSED:
        rows = [r for r in missed if r[0] == m]
        bad = [r for r in rows if r[3]]
        print(f"At {m}, one missed badge costs a target node in {len(bad)} of {len(rows)} cases")
        for _, aid, bid, lost, _ in bad[:5]:
            print(f"  {aid} without {bid} loses node {', '.join(map(str, lost))}")
        if len(bad) > 5:
            per = {a["id"]: sum(1 for r in bad if r[1] == a["id"]) for a in archetypes}
            print("  by archetype: " + ", ".join(f"{k} {v}" for k, v in per.items()))


if __name__ == "__main__":
    main()
