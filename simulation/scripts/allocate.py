"""Allocation helper: which badges a student allocates to which target nodes.

Given the badges a student holds and has not allocated, the target nodes the
student pursues, and the nodes already unlocked, it finds the allocation that
unlocks the most target nodes and, among those, allocates the fewest skill
points. A node counts only if one of its prerequisite groups is held or
unlocked in the same allocation. A badge goes to one node at most and is
allocated whole. Both steps are 0-1 integer linear programs, solved with SciPy.

The contract checks each allocation on its own (Equation 3.2), so the helper
runs off-chain and only proposes the allocation the student then submits,
node by node, in target order.

Usage: python3 allocate.py A4
       allocates every badge of the nine courses of archetype A4, as a check.
"""
import json
import os
import sys

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec")


def allocate(badges, targets, nodes, held=()):
    """badges:  list of {"id", "points", "skillPoints"}, the badges free to allocate.
    targets: target node ids, in allocation order.
    nodes:   {id: {"threshold": {type: amount}, "prerequisiteGroups": [[id, ...], ...]}}
    held:    node ids already unlocked.
    Returns {node id: [badge ids]} for the nodes unlocked, in target order."""
    held = set(held)
    todo = [n for n in targets if n not in held]
    if not todo or not badges:
        return {}
    nb, nn = len(badges), len(todo)
    pos = {n: j for j, n in enumerate(todo)}

    # Variables: x[b, n] badge b to node n, then y[n] node n unlocked,
    # then z[n, g] prerequisite group g of node n held.
    groups = [(j, g) for j, n in enumerate(todo) for g in nodes[n]["prerequisiteGroups"]]
    nx, ny, nz = nb * nn, nn, len(groups)
    nv = nx + ny + nz
    X = lambda i, j: i * nn + j
    Y = lambda j: nx + j
    Z = lambda k: nx + ny + k

    rows, low, high = [], [], []

    def row(coefs, lo, hi):
        r = np.zeros(nv)
        for k, v in coefs:
            r[k] += v
        rows.append(r), low.append(lo), high.append(hi)

    for i in range(nb):  # each badge to one node at most
        row([(X(i, j), 1) for j in range(nn)], 0, 1)
    for j, n in enumerate(todo):
        for t, need in nodes[n]["threshold"].items():  # threshold met if unlocked
            row([(X(i, j), b["skillPoints"].get(t, 0)) for i, b in enumerate(badges)] + [(Y(j), -need)], 0, np.inf)
        for i in range(nb):  # no badge to a node that is not unlocked
            row([(X(i, j), 1), (Y(j), -1)], -np.inf, 0)
        own = [k for k, (jj, _) in enumerate(groups) if jj == j]
        if own:  # one prerequisite group held, for a node that has groups
            row([(Z(k), 1) for k in own] + [(Y(j), -1)], 0, np.inf)
    for k, (j, g) in enumerate(groups):
        for m in g:
            if m in held:
                continue
            if m in pos:  # the prerequisite is unlocked in the same allocation
                row([(Z(k), 1), (Y(pos[m]), -1)], -np.inf, 0)
            else:  # neither held nor pursued
                row([(Z(k), 1)], 0, 0)

    A = np.array(rows)
    cons = LinearConstraint(A, low, high)
    opts = {"mip_rel_gap": 0}
    ints, bounds = np.ones(nv), Bounds(0, 1)

    # Step 1: most target nodes unlocked.
    c1 = np.zeros(nv)
    c1[nx:nx + ny] = -1
    r1 = milp(c1, constraints=cons, integrality=ints, bounds=bounds, options=opts)
    count = round(-r1.fun)
    if count == 0:
        return {}

    # Step 2: with that many nodes, fewest points. A tie between equal points
    # goes to the badges listed first, through a cost below one point in total.
    c2 = np.zeros(nv)
    for i, b in enumerate(badges):
        for j in range(nn):
            c2[X(i, j)] = b["points"] + (i + 1) / (10 * nb * nb)
    keep = np.zeros(nv)
    keep[nx:nx + ny] = 1
    cons2 = [cons, LinearConstraint(keep[None, :], count, count)]
    r2 = milp(c2, constraints=cons2, integrality=ints, bounds=bounds, options=opts)
    x = np.round(r2.x).astype(int)

    out = {}
    for j, n in enumerate(todo):
        if x[Y(j)]:
            out[n] = [badges[i]["id"] for i in range(nb) if x[X(i, j)]]
    return out


def load():
    """Badges by course, graph nodes and archetypes, from the JSON files."""
    courses = json.load(open(os.path.join(SPEC, "courses.json"), encoding="utf-8"))["courses"]
    graph = json.load(open(os.path.join(SPEC, "graph.json"), encoding="utf-8"))["nodes"]
    archetypes = json.load(open(os.path.join(SPEC, "archetypes.json"), encoding="utf-8"))["archetypes"]
    badges = {c["code"]: c["badges"] for c in courses}
    nodes = {n["id"]: n for n in graph}
    return badges, nodes, {a["id"]: a for a in archetypes}


if __name__ == "__main__":
    badges, nodes, archetypes = load()
    a = archetypes[sys.argv[1]]
    pool = [b for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p] for b in badges[c]]
    result = allocate(pool, a["targetNodes"], nodes)
    points = {b["id"]: b["points"] for b in pool}
    for n, ids in result.items():
        print(f"node {n:2d}: {', '.join(ids)}")
    print(f"{len(result)} of {len(a['targetNodes'])} target nodes, {sum(points[i] for ids in result.values() for i in ids)} points")
