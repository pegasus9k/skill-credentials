"""Recompute the numbers of the Chapter 5 tables from the files of this repository.

Usage: python3 verify_ch5_tables.py <repo>/simulation
"""
import collections
import csv
import itertools
import json
import math
import os
import sys

SIM = sys.argv[1]
sys.path.insert(0, os.path.join(SIM, "scripts"))
from allocate import allocate  # noqa: E402

J = lambda p: json.load(open(os.path.join(SIM, p), encoding="utf-8"))
courses = J("spec/courses.json")["courses"]
TYPES = J("spec/courses.json")["skillTypes"]
graph = {n["id"]: n for n in J("spec/graph.json")["nodes"]}
arch = {a["id"]: a for a in J("spec/archetypes.json")["archetypes"]}
posts = J("spec/thirdPartyPosts.json")
year = J("spec/simulatedYear.json")
stu = {s["id"]: s for s in year["students"]}
exp = {e["student"]: e for e in year["expected"]}
rows = {r["student"]: r for r in csv.DictReader(open(os.path.join(SIM, "replay/contracts/students.csv")))}
tx = list(csv.DictReader(open(os.path.join(SIM, "replay/contracts/txlog.csv"))))

byid = {b["id"]: b for c in courses for b in c["badges"]}
course_of = {b["id"]: c["code"] for c in courses for b in c["badges"]}
cinfo = {c["code"]: c for c in courses}
tier = {n: graph[n]["tier"] for n in graph}

def hdr(t):
    print(f"\n=== {t}")

# ---------- 5.1.1 / 5.1.2 courses and badges
hdr("Courses and badges (5.1.1, 5.1.2, Fig 5.5, Table 5.4)")
print("badges:", len(byid), "courses:", len(courses))
sums = {}
for c in courses:
    tot = collections.Counter()
    for b in c["badges"]:
        assert sum(b["skillPoints"].values()) == b["points"], b["id"]
        tot.update(b["skillPoints"])
    sums[c["code"]] = tot
    if sum(tot.values()) != 60:
        print("COURSE NOT 60:", c["code"], sum(tot.values()))
col = collections.Counter()
for t in sums.values():
    col.update(t)
print("type totals:", [col[t] for t in TYPES], "sum", sum(col.values()))
for area in ("CRAI", "Energy"):
    print(area, "courses", sum(1 for c in courses if c["area"] == area),
          "points", sum(sum(sums[c["code"]].values()) for c in courses if c["area"] == area))
print("courses per type:", {t: sum(1 for s in sums.values() if s[t]) for t in TYPES})
for t in ("DL", "PWR", "GRID", "THERMO"):
    print(t, "in", sorted((cinfo[c]["area"], cinfo[c]["season"], c) for c, s in sums.items() if s[t]))
print("Rob:", dict(sums["Rob"]), [(b["id"], b["points"], b["skillPoints"]) for b in cinfo["Rob"]["badges"]])
math_b = [b for b in byid.values() if "MATH" in b["skillPoints"]]
exams = [b for b in byid.values() if "exam" in b["assessment"].lower()]
print("badges with MATH:", len(math_b), "exam badges:", len(exams),
      "exam badges with MATH:", sum(1 for b in exams if "MATH" in b["skillPoints"]))

# ---------- Fig 5.7 pairs and Fundamentals pairs
hdr("Pairs (Fig 5.7) and Fundamentals node pairs")
pair = {}
ncourses = {}
for a, b in itertools.combinations(TYPES, 2):
    vals = [min(s[a], s[b]) for s in sums.values() if s[a] and s[b]]
    pair[(a, b)] = sum(vals)
    ncourses[(a, b)] = len(vals)
for i, a in enumerate(TYPES[1:], 1):
    print(f"{a:7s}", " ".join(f"{pair[(TYPES[j], a)] if pair[(TYPES[j], a)] else '-':>4}" for j in range(i)))
for n in range(1, 12):
    ts = list(graph[n]["threshold"])
    key = tuple(sorted(ts, key=TYPES.index))
    print(f"node {n:2d} {key}: {ncourses[key]} courses, {pair[key]} points")

# ---------- archetypes, Table 5.5 / 5.13 assessments
hdr("Archetypes (Table 5.5, 5.13 assessments, supply)")
for a in arch.values():
    cs = [c for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p]]
    supply = collections.Counter()
    for c in cs:
        supply.update(sums[c])
    n_assess = sum(len(cinfo[c]["badges"]) for c in cs)
    s1 = [c for c in cs if cinfo[c]["season"] == 1]
    print(a["id"], "courses", len(cs), "S1", len(s1), "assessments", n_assess,
          "supply matches json:", dict(supply) == {k: v for k, v in a["supply"].items()},
          "PWR", supply["PWR"], "CODE", supply["CODE"])

# ---------- thresholds, Equation 5.1
hdr("Thresholds recomputed from Equation 5.1 (Table 5.6)")
W = {"Fundamentals": 1.0, "Specialist": 1.5, "Architect": 2.0}
bad = 0
for n, node in graph.items():
    for t, amount in node["threshold"].items():
        vals = []
        for a in arch.values():
            if n not in a["targetNodes"]:
                continue
            cs = [c for p in ("P1", "P2", "P3", "P4") for c in a["courses"][p]]
            P = sum(sums[c][t] for c in cs)
            wsum = sum(W[tier[m]] for m in a["targetNodes"] if t in graph[m]["threshold"])
            vals.append(math.floor(0.7 * W[tier[n]] / wsum * P + 1e-9))
        v = min(min(vals), 10 if t == "MATH" else 20)
        if v != amount:
            bad += 1
            print("DIFF node", n, t, "graph.json", amount, "recomputed", v, vals)
print("threshold differences:", bad)

# ---------- 5.2 year file
hdr("Year file (5.2, Table 5.8)")
st = collections.Counter(a["status"] for a in year["assessments"])
print("assessments", len(year["assessments"]), st, "events", len(year["events"]),
      "mints", sum(1 for e in year["events"] if e["type"] == "mintBadge"))
grp = lambda s: rows[s]["group"]
print("groups:", collections.Counter(grp(s) for s in stu))
drawn = [s for s in stu if stu[s]["class"] != "reference"]
rates = []
fails = taken = 0
for s in drawn:
    g = [a["grade"] for a in year["assessments"] if a["student"] == s and a["status"] == "taken"]
    f = sum(1 for x in g if x < 10)
    fails += f
    taken += len(g)
    rates.append(f / len(g))
print(f"fail rate of drawn students: mean per student {100 * sum(rates) / len(rates):.2f}%, pooled {100 * fails / taken:.2f}%")

# ---------- Table 5.9
hdr("Table 5.9")
possible = collections.Counter(a["student"] for a in year["assessments"])
order = ["reference", "regular-15-30", "regular-30", "skips", "dropout"]
for g in order + ["all"]:
    ss = [s for s in stu if g == "all" or grp(s) == g]
    bshare = sum(int(rows[s]["badges"]) / possible[s] for s in ss) / len(ss)
    tshare = sum(int(rows[s]["target_nodes_held"]) / int(rows[s]["target_nodes"]) for s in ss) / len(ss)
    full = collections.Counter(rows[s]["archetype"] for s in ss if rows[s]["target_nodes_held"] == rows[s]["target_nodes"])
    print(f"{g:14s} {len(ss):3d} badges {100 * bshare:5.1f}% targets {100 * tshare:5.1f}% "
          f"all-target {[full[a] for a in ('A1', 'A2', 'A3', 'A4', 'A5')]} = {sum(full.values())}")
pooled = sum(int(r["badges"]) for r in rows.values()) / sum(possible.values())
print(f"pooled badge share {100 * pooled:.1f}%")

# ---------- 5.3.1 text around Table 5.9
hdr("5.3.1 text")
w15 = [s for s in stu if 15 in stu[s]["allocationWeeks"]]
n15 = [(s, n) for s in w15 for n, w in exp[s]["nodes"].items() if w == 15]
print("students allocating in week 15:", len(w15), "nodes unlocked in week 15:", len(n15),
      "Specialist among them:", sum(1 for _, n in n15 if tier[int(n)] == "Specialist"))
miss = [s for s in stu if rows[s]["target_nodes_held"] != rows[s]["target_nodes"]]
timing = []
for s in miss:
    if stu[s]["allocationWeeks"] != [15, 30]:
        continue
    a = arch[stu[s]["archetype"]]
    once = allocate([byid[b] for b in exp[s]["badges"]], a["targetNodes"], graph)
    if set(a["targetNodes"]) <= set(once):
        timing.append((s, stu[s]["archetype"]))
print("miss a target:", len(miss), "lost to timing:", len(timing), collections.Counter(a for _, a in timing))

# ---------- Table 5.10 dropouts
hdr("Table 5.10 dropouts")
full_s1 = {}
for a in arch.values():
    pool = [b for p in ("P1", "P2") for c in a["courses"][p] for b in cinfo[c]["badges"]]
    full_s1[a["id"]] = len(allocate(pool, a["targetNodes"], graph))
pts = []
for s in sorted(stu):
    if stu[s]["class"] != "dropout":
        continue
    p = sum(byid[b]["points"] for b in exp[s]["badges"])
    pts.append(p)
    held = sorted(map(int, exp[s]["nodes"]))
    print(s, stu[s]["archetype"], "points", p, "nodes", held, "full-S1 count", full_s1[stu[s]["archetype"]])
print(f"mean points {sum(pts) / len(pts):.2f}")
drop = [s for s in stu if stu[s]["class"] == "dropout"]
print("as many nodes as full S1:", sum(1 for s in drop if len(exp[s]["nodes"]) == full_s1[stu[s]["archetype"]]),
      "holding 13, 14 or 18:", sum(1 for s in drop if {"13", "14", "18"} & set(exp[s]["nodes"])),
      "node counts:", sorted(len(exp[s]["nodes"]) for s in drop))
sk = [s for s in stu if stu[s]["class"] == "skips"]
print("skips node counts:", sorted(len(exp[s]["nodes"]) for s in sk))

# ---------- shared targets reached by both archetypes
hdr("Shared targets")
targ = collections.defaultdict(set)
for a in arch.values():
    for n in a["targetNodes"]:
        targ[n].add(a["id"])
for n, aa in sorted(targ.items()):
    if len(aa) > 1:
        reached = {a: sum(1 for s in stu if stu[s]["archetype"] == a and str(n) in exp[s]["nodes"]) for a in sorted(aa)}
        print("node", n, reached)
print("node 22 holders by archetype:", collections.Counter(stu[s]["archetype"] for s in stu if "22" in exp[s]["nodes"]))

# ---------- Table 5.11 posts
hdr("Table 5.11")
ref = {s for s in stu if stu[s]["class"] == "reference"}
def holders(nodes):
    return {s for s in stu if all(str(n) in exp[s]["nodes"] for n in nodes)}
for p in posts["paths"]:
    h = holders(p["nodes"])
    app = {s for s in stu if p["id"] in exp[s]["applications"]}
    print(f"Path {p['id']}: holders {len(h)} {dict(collections.Counter(stu[s]['archetype'] for s in h))}, "
          f"applied {len(app)} {dict(collections.Counter(stu[s]['archetype'] for s in app))}, "
          f"holders minus reference {len(h - ref)}")
for sl in posts["projects"][0]["slots"]:
    h = holders(sl["nodes"])
    took = {s for s in stu if exp[s]["team"] and exp[s]["team"]["slot"] == sl["slot"]}
    print(f"Slot {sl['slot']} {sl['nodes']}: holders {len(h)} {dict(collections.Counter(stu[s]['archetype'] for s in h))}, "
          f"in a slot {len(took)}, holders minus reference {len(h - ref)}")
teams = collections.defaultdict(list)
for s in stu:
    if exp[s]["team"]:
        teams[exp[s]["team"]["team"]].append((exp[s]["team"]["slot"], s, exp[s]["team"]["formed"]))
formed = {t for t, m in teams.items() if any(f for _, _, f in m)}
print("teams", len(teams), "formed", len(formed), "members of formed", sum(len(teams[t]) for t in formed))
users = {s for s in stu if exp[s]["applications"] or exp[s]["team"]}
print("distinct post users:", len(users))
# formation order from the txlog
form_order = [int(r["seq"]) for r in tx if r["function"] == "joinTeam" and r["event"] and "form" in r["event"]]
arch_node = {1: 24, 2: 22, 3: 21, 4: 23}
no_arch = [(t, sl, s) for t in formed for sl, s, _ in teams[t] if str(arch_node[sl]) not in exp[s]["nodes"]]
print("members of formed teams without the Architect node above their slot:", no_arch)
skip_full = [s for s in sk if rows[s]["target_nodes_held"] == rows[s]["target_nodes"]]
print("skips with every target:", [(s, stu[s]["archetype"], exp[s]["applications"], exp[s]["team"]) for s in skip_full])

# ---------- allocations by tier
hdr("Badges per allocation by tier")
per = collections.defaultdict(list)
for e in year["events"]:
    if e["type"] == "allocateBadges":
        per[tier[e["node"]]].append(len(e["badges"]))
for t, v in per.items():
    print(t, len(v), f"mean badges {sum(v) / len(v):.2f}")
allv = [x for v in per.values() for x in v]
print("all", len(allv), f"mean {sum(allv) / len(allv):.2f}")
