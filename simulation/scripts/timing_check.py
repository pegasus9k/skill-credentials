"""Allocation timing check for Section 5.3.1.

For every student who misses a target node of its archetype, allocate the same
final badges once, as a single allocation in week 30. If that allocation reaches
every target node, the miss comes from allocating early, in week 15 (timing).
If not, it comes from the badges the student does not hold (failed, skipped or
dropped assessments).

Reads simulatedYear.json and the spec files from ../spec, and uses the
allocation script, allocate.py. Draws nothing.

Usage: python3 timing_check.py
"""
import json
import os

from allocate import SPEC, allocate, load

badges, nodes, archetypes = load()
by_id = {b["id"]: b for course in badges.values() for b in course}
year = json.load(open(os.path.join(SPEC, "simulatedYear.json"), encoding="utf-8"))
expected = {e["student"]: e for e in year["expected"]}


def group(s):
    if s["class"] == "regular":
        return "regular, weeks 15 and 30" if 15 in s["allocationWeeks"] else "regular, week 30"
    return s["class"]


counts = {}
for s in year["students"]:
    targets = archetypes[s["archetype"]]["targetNodes"]
    held = {int(n) for n in expected[s["id"]]["nodes"]}
    missing = sorted(set(targets) - held)
    if not missing:
        continue
    once = allocate([by_id[b] for b in expected[s["id"]]["badges"]], targets, nodes)
    still = sorted(set(targets) - set(once))
    cause = "timing" if not still else "badges not held"
    key = (group(s), cause)
    counts[key] = counts.get(key, 0) + 1
    print(f"{s['id']} {s['archetype']} {group(s):26s} holds {len(held)} of {len(targets)}, misses {missing}; "
          f"one allocation in week 30 reaches {len(once)} of {len(targets)} -> {cause}")

print()
for (g, cause), n in sorted(counts.items()):
    print(f"{g:26s} {cause:16s} {n}")
