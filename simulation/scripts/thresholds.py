"""Threshold amounts of the competency graph (Equation 5.1) and the completion check.

Reads graphStructure.json, courses.json and archetypes.json, and writes
graph.json, the structure of the graph with the threshold amounts. Stops if a
student who earns every badge of an archetype cannot unlock all its target
nodes, with the allocation helper of allocate.py. Prints the thresholds and the
points each archetype allocates. Needs SciPy.

Usage: python3 thresholds.py graphStructure.json courses.json archetypes.json graph.json
       Without arguments, it reads and writes the files of ../spec.
"""
import json
import os
import sys
from fractions import Fraction
from math import floor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from allocate import allocate

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "spec")
PERIODS = ["P1", "P2", "P3", "P4"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def derive(structure, archetypes):
    """Equation 5.1. Returns {node id: {type: amount}}.

    The supply of each archetype is the one of archetypes.json, checked against
    the badges when archetypes.json is built. Exact arithmetic, so a share that
    is a whole number is not rounded down by one."""
    d = structure["derivation"]
    margin = Fraction(str(d["margin"]))
    weight = {tier: Fraction(str(w)) for tier, w in d["tierWeights"].items()}
    nodes = {n["id"]: n for n in structure["nodes"]}
    thr = {}
    for n, node in nodes.items():
        thr[n] = {}
        for k in node["thresholdTypes"]:
            # Share of the supply of k by tier weight, among the target nodes
            # that ask for k, margin, rounded down, for every archetype that
            # targets the node. Then the lowest value and the caps.
            vals = []
            for a in archetypes:
                if n in a["targetNodes"]:
                    total = sum(weight[nodes[m]["tier"]] for m in a["targetNodes"] if k in nodes[m]["thresholdTypes"])
                    vals.append(floor(margin * a["supply"].get(k, 0) * weight[node["tier"]] / total))
            assert vals, f"Node {n}: the target of no archetype"
            thr[n][k] = min(min(vals), d["capMATH"] if k == "MATH" else d["capPerType"])
            assert thr[n][k] >= 1, f"Node {n}: {k} amount rounds down to 0"
    return thr


def completion_check(structure, thr, courses, archetypes):
    """A student who earns every badge of an archetype must be able to unlock
    all its target nodes. Returns the points allocated, per archetype."""
    badges = {c["code"]: c["badges"] for c in courses}
    nodes = {n["id"]: {"threshold": thr[n["id"]], "prerequisiteGroups": n["prerequisiteGroups"]}
             for n in structure["nodes"]}
    allocated = {}
    for a in archetypes:
        pool = [b for p in PERIODS for c in a["courses"][p] for b in badges[c]]
        result = allocate(pool, a["targetNodes"], nodes)
        missing = sorted(set(a["targetNodes"]) - set(result))
        assert not missing, f"{a['id']} cannot unlock nodes {missing}"
        points = {b["id"]: b["points"] for b in pool}
        allocated[a["id"]] = sum(points[i] for ids in result.values() for i in ids)
    return allocated


def main(structure_path, courses_path, archetypes_path, json_path):
    structure = load(structure_path)
    courses = load(courses_path)["courses"]
    archetypes = load(archetypes_path)["archetypes"]

    thr = derive(structure, archetypes)
    allocated = completion_check(structure, thr, courses, archetypes)

    nodes = [{"id": n["id"], "name": n["name"], "tier": n["tier"],
              "prerequisiteGroups": n["prerequisiteGroups"], "threshold": thr[n["id"]]}
             for n in structure["nodes"]]
    head = {
        "source": "thresholds.py",
        "inputs": [os.path.basename(p) for p in (structure_path, courses_path, archetypes_path)],
        "definedInSeason": structure["definedInSeason"],
        "derivation": structure["derivation"],
    }
    # One node per line, as in graphStructure.json.
    out = "{\n" + "".join(f'  "{k}": {json.dumps(v)},\n' for k, v in head.items())
    out += '  "nodes": [\n' + ",\n".join("    " + json.dumps(n) for n in nodes) + "\n  ]\n}\n"
    json.loads(out)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(out)

    for n in nodes:
        print(f"{n['id']:2d} {n['name']:34s} " + ", ".join(f"{k}: {v}" for k, v in n["threshold"].items()))
    for a in archetypes:
        supply = sum(a["supply"].values())
        print(f"{a['id']} unlocks every target node with {allocated[a['id']]} of {supply} points")
    print(f"{len(nodes)} nodes written to {json_path}")


if __name__ == "__main__":
    files = ("graphStructure.json", "courses.json", "archetypes.json", "graph.json")
    main(*(sys.argv[1:5] or [os.path.join(SPEC, f) for f in files]))
