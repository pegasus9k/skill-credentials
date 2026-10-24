"""Counts used in 5.5 and Chapter 6 that are not in summary.md.

Run from simulation/catalogue:
    python3 check_discussion_counts.py

Course grade rule (5.5): weighted mean of the assessment grades, a skipped
assessment counts as zero, rounded half up, pass at 10. Dropped courses are
not enrolments.
"""
import collections
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from allocate import allocate, load  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
badges, nodes, arch = load()
byid = {b["id"]: b for cs in badges.values() for b in cs}
course_of = {b["id"]: c for c, cs in badges.items() for b in cs}
year = json.load(open(os.path.join(HERE, "..", "spec", "simulatedYear.json")))
exp = {e["student"]: e for e in year["expected"]}
stu = {s["id"]: s for s in year["students"]}


def route(s):
    a = arch[stu[s]["archetype"]]
    return {c for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p]}


# Course grades
acc = collections.defaultdict(lambda: [0.0, 0, False])
for a in year["assessments"]:
    k = (a["student"], course_of[a["badge"]])
    if a["status"] == "dropped":
        acc[k][2] = True
        continue
    g = a["grade"] if a["status"] == "taken" else 0
    acc[k][0] += byid[a["badge"]]["points"] * g
    acc[k][1] += byid[a["badge"]]["points"]

passed, failed, enrol = collections.defaultdict(set), collections.defaultdict(set), 0
for (s, c), (sg, sp, dropped) in acc.items():
    if dropped:
        continue
    enrol += 1
    (passed if math.floor(sg / sp + 0.5) >= 10 else failed)[s].add(c)
nb = sum(1 for s, cs in failed.items() for b in exp[s]["badges"] if course_of[b] in cs)
print(f"enrolments {enrol}, failed courses {sum(map(len, failed.values()))}, badges from them {nb}")

# Transcript filter for node 22 (routes of A2 and A5) and node 24 (A1)
for node, routes in ((22, ("A2", "A5")), (24, ("A1",))):
    holders = {s for s in stu if str(node) in exp[s]["nodes"]}
    filt = {s for s in stu for r in routes if stu[s]["archetype"] == r and route(s) <= passed[s]}
    print(f"node {node}: holders {len(holders)}, filter on passed courses {len(filt)}, "
          f"in filter without node {sorted(filt - holders)}, holders the filter misses {sorted(holders - filt)}")

# Students who pass every course of their route: targets held, and with one week-30 allocation
rows = []
for s, st in stu.items():
    if st["class"] in ("dropout", "reference") or not route(s) <= passed[s]:
        continue
    tg = set(arch[st["archetype"]]["targetNodes"])
    held = set(map(int, exp[s]["nodes"]))
    once = set(allocate([byid[b] for b in exp[s]["badges"]], arch[st["archetype"]]["targetNodes"], nodes))
    rows.append((s, tg <= held, tg <= once))
miss = [r for r in rows if not r[1]]
print(f"pass every course: {len(rows)}, hold every target {sum(r[1] for r in rows)}, "
      f"miss a target {len(miss)}, of them lost to week 15 {sum(r[2] for r in miss)}, "
      f"lost to assessments {[r[0] for r in miss if not r[2]]}")

# Students who apply or take a slot and fail at least one course
users = [s for s, e in exp.items() if e["applications"] or e["team"]]
print(f"post users {len(users)}, of them with a failed course {len(failed.keys() & set(users))}: "
      f"{sorted(failed.keys() & set(users))}")

# Gas share of the institution, with and without the setup
tx = list(csv.DictReader(open(os.path.join(HERE, "..", "replay", "contracts", "txlog.csv"))))
inst = ("deployer", "administrator", "registrar", "oracle")
for phase in ("year", None):
    rs = [r for r in tx if phase is None or r["phase"] == phase]
    tot = sum(int(r["gas_used"]) for r in rs)
    own = sum(int(r["gas_used"]) for r in rs if r["signer"] in inst)
    print(f"{phase or 'setup and year'}: institution {own / 1e6:.2f}M of {tot / 1e6:.2f}M gas, {100 * own / tot:.1f}%")
